import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/core';
import {
  CONNECTION_NOTICE_DELAY_MS,
  readConnectionStatus,
  startConnectionWatch,
  subscribeToConnectionStatus,
} from './connectionStatus';

let stopWatch: (() => void) | null = null;
let networkListeners: Map<string, Array<() => void>>;

function dropConnection(): void {
  eventBus.emit(WS_EVENTS.SOCKET.DISCONNECTED as never, {} as never);
}

function restoreConnection(): void {
  eventBus.emit(WS_EVENTS.SOCKET.CONNECTED as never, {} as never);
}

function reportNetwork(event: 'online' | 'offline'): void {
  for (const listener of networkListeners.get(event) ?? []) listener();
}

beforeEach(() => {
  vi.useFakeTimers();
  networkListeners = new Map();

  vi.stubGlobal('window', {
    addEventListener: (type: string, handler: () => void) => {
      networkListeners.set(type, [...(networkListeners.get(type) ?? []), handler]);
    },
    removeEventListener: (type: string, handler: () => void) => {
      networkListeners.set(
        type,
        (networkListeners.get(type) ?? []).filter((fn) => fn !== handler)
      );
    },
  });
  vi.stubGlobal('navigator', { onLine: true });

  stopWatch = startConnectionWatch();
});

afterEach(() => {
  stopWatch?.();
  stopWatch = null;
  eventBus.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('состояние связи', () => {
  it('should say nothing while the connection holds', () => {
    expect(readConnectionStatus()).toBe('connected');
  });

  it('should stay quiet through a blink of the connection', () => {
    // Обычное переподключение занимает около секунды. Надпись, мигающая на
    // каждом моргании связи, приучает не обращать на себя внимания как раз
    // к тому случаю, ради которого заведена.
    let notices = 0;
    subscribeToConnectionStatus(() => {
      notices += 1;
    });

    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS - 1);
    restoreConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('connected');
    expect(notices).toBe(0);
  });

  it('should complain when the outage outlasts the delay', () => {
    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('connecting');
  });

  it('should name the trouble the browser reports', () => {
    // Своя сеть отвалилась или сервер не отвечает — это разные беды, и
    // чинить их человеку приходится по-разному.
    vi.stubGlobal('navigator', { onLine: false });

    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('offline');
  });

  it('should complain about a lost network before the socket notices', () => {
    // Браузер, уходя в офлайн, не закрывает уже открытый сокет: тот считает
    // себя живым до самого таймаута, хотя сообщения через него не ходят.
    // Проверено вживую: без этого приложение молчало всё время обрыва.
    vi.stubGlobal('navigator', { onLine: false });
    reportNetwork('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('offline');
  });

  it('should stop complaining when the network returns and the socket never dropped', () => {
    vi.stubGlobal('navigator', { onLine: false });
    reportNetwork('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    vi.stubGlobal('navigator', { onLine: true });
    reportNetwork('online');

    expect(readConnectionStatus()).toBe('connected');
  });

  it('should rename the trouble when the network comes back but the server does not', () => {
    vi.stubGlobal('navigator', { onLine: false });
    dropConnection();
    reportNetwork('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    expect(readConnectionStatus()).toBe('offline');

    vi.stubGlobal('navigator', { onLine: true });
    reportNetwork('online');

    // Сеть вернулась, связи всё ещё нет: жалоба остаётся, меняется текст.
    expect(readConnectionStatus()).toBe('connecting');
  });

  it('should not restart the delay when one trouble replaces another', () => {
    // Отсчитывать задержку заново значило бы на две секунды объявить, что
    // всё хорошо, когда это не так.
    vi.stubGlobal('navigator', { onLine: false });
    reportNetwork('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    dropConnection();
    vi.stubGlobal('navigator', { onLine: true });
    reportNetwork('online');

    expect(readConnectionStatus()).toBe('connecting');
  });

  it('should clear the complaint the moment the connection returns', () => {
    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    expect(readConnectionStatus()).toBe('connecting');

    restoreConnection();

    expect(readConnectionStatus()).toBe('connected');
  });

  it('should tell its subscriber once per outage', () => {
    let notices = 0;
    subscribeToConnectionStatus(() => {
      notices += 1;
    });

    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    // Повторные обрывы, пока связи всё нет, ничего не меняют.
    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS * 3);

    expect(notices).toBe(1);
  });

  it('should let go of everything when the session ends', () => {
    dropConnection();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    stopWatch?.();
    stopWatch = null;

    expect(readConnectionStatus()).toBe('connected');
    expect(networkListeners.get('online')).toEqual([]);
    expect(networkListeners.get('offline')).toEqual([]);
  });
});
