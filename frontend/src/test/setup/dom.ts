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
import { clearChatCache } from '@/core/chatCache';
import { eventBus } from '@/core/EventBus';
import { resetRealtimeSocketForTests } from '@/hooks/useRealtimeSocket';
import { useCallStore } from '@/store/call';
import { useChatStore } from '@/store/chat';
import { useChatsStore } from '@/store/chats';
import { useProfileStore } from '@/store/profile';
import { useToastStore } from '@/store/toast';

// ── Полифилы, которых нет в jsdom ────────────────────────────────────────────

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
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
  resetRealtimeSocketForTests();
  // Кеш чатов живёт на уровне модуля: без сброса в нём остаются промисы
  // предыдущего теста, и расшифровка ждёт ответа, которого не будет.
  clearChatCache();

  useCallStore.setState(useCallStore.getInitialState(), true);
  useChatsStore.setState(useChatsStore.getInitialState(), true);
  useChatStore.setState(useChatStore.getInitialState(), true);
  useProfileStore.setState(useProfileStore.getInitialState(), true);
  useToastStore.setState(useToastStore.getInitialState(), true);

  localStorage.clear();
});

expect.extend({});
