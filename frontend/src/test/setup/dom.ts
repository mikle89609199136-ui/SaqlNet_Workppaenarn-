import { clearToasts } from '@/shared/ui';
/**
 * Подготовка окружения `jsdom` для тестов хуков, компонентов и интеграции.
 *
 * Задача файла — сделать каждый тест воспроизводимым независимо от порядка
 * запуска. В приложении есть глобальное состояние, которое иначе протекает
 * между тестами: шина событий, общий сокет и сторы.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { registerChatResolver } from '@/queries/chat/chatResolverBridge';
import { queryClient } from '@/queries/queryClient';
import { eventBus } from '@/core/EventBus';
import { resetRealtimeSocketForTests } from '@/shared/api';
import { useCallStore } from '@/features/call';
import { useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { clearOutbox } from '@/entities/message';

// ── Полифилы, которых нет в jsdom ────────────────────────────────────────────

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const original = originalGetBoundingClientRect ? originalGetBoundingClientRect.call(this) : null;
  if (!original || (original.width === 0 && original.height === 0)) {
    return {
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => '',
    };
  }
  return original;
};

if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')?.get) {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    get() {
      return this._clientHeight ?? 600;
    },
    set(val) {
      this._clientHeight = val;
    },
    configurable: true,
  });
}

if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')?.get) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    get() {
      return this._clientWidth ?? 800;
    },
    set(val) {
      this._clientWidth = val;
    },
    configurable: true,
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      const entry = {
        target,
        contentRect: rect,
        borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this);
    }
    unobserve() {}
    disconnect() {}
  };
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
  globalThis.URL.revokeObjectURL = vi.fn();
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
}

if (!globalThis.Notification) {
  globalThis.Notification = Object.assign(vi.fn(), {
    permission: 'granted',
    requestPermission: vi.fn().mockResolvedValue('granted'),
  }) as unknown as typeof Notification;
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

// ── Тишина в консоли как условие прохождения теста ───────────────────────────

// В приложении console.warn — штатный способ проглотить ошибку расшифровки
// (MessageService, decryptChatPreview). Без этой проверки сломанная
// расшифровка прошла бы как зелёный тест.
const EXPECTED_CONSOLE_PATTERNS: RegExp[] = [
  // Пополняется осознанно: каждая запись — сообщение, которое тест ожидает.
];

const originalError = console.error;
const originalWarn = console.warn;

function assertExpected(kind: 'error' | 'warn', args: unknown[]) {
  const text = args.map(String).join(' ');
  const expected = EXPECTED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));

  if (!expected) {
    throw new Error(`Неожиданный console.${kind} в тесте: ${text}`);
  }
}

beforeEach(() => {
  /* Связь шифрования с кешем запросов ставится перед каждым тестом, а не
     только восстанавливается после. Её снимает `chatResolverBridge`, где
     проверяется поведение незарегистрированного источника, и без общей
     изоляции этот `null` доставался следующему файлу: расшифровка
     превью падала, а уведомление показывало запасной текст вместо
     сообщения. */
  registerChatResolver();

  console.error = (...args: unknown[]) => {
    originalError(...args);
    assertExpected('error', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    assertExpected('warn', args);
  };
});

// ── Сброс глобального состояния между тестами ────────────────────────────────

afterEach(() => {
  console.error = originalError;
  console.warn = originalWarn;

  cleanup();

  // Шина и сокет — синглтоны на модуль: без сброса подписки прошлого теста
  // продолжают срабатывать в следующем.
  eventBus.clear();
  // Кеш запросов приложения — синглтон: без сброса в нём остаются чаты
  // предыдущего сценария. Связь с шифрованием ставится заново, как это
  // делает точка входа; харнесс подменяет её своим клиентом.
  queryClient.clear();
  registerChatResolver();
  resetRealtimeSocketForTests();
  // Кеш чатов живёт на уровне модуля: без сброса в нём остаются промисы
  // предыдущего теста, и расшифровка ждёт ответа, которого не будет.

  /* Язык — такой же синглтон на модуль, как сторы: тесты настроек
     переключают его на английский через `useApplyPreferences`, а форма
     регистрации потом берёт язык из i18n и отправляет на сервер. Пока
     файлы шли в отдельных окружениях, чужой язык не доживал до
     следующего; теперь модули общие, и сброс нужен явный. */
  if (testI18n.language !== 'ru') void testI18n.changeLanguage('ru');

  /* Подменённые таймеры и глобальные объекты возвращаются на место по
     той же причине: без изоляции они переживают файл, в котором их
     подменили. */
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();

  useCallStore.setState(useCallStore.getInitialState(), true);
  useChatUiStore.setState(useChatUiStore.getInitialState(), true);
  useProfileStore.setState(useProfileStore.getInitialState(), true);
  clearToasts();
  clearOutbox();

  localStorage.clear();
});

expect.extend({});
