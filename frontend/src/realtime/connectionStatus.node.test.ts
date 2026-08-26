import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '@/consts';
import { eventBus } from '@/core';
import {
  CONNECTION_NOTICE_DELAY_MS,
  readConnectionStatus,
  startConnectionWatch,
  subscribeToConnectionStatus,
} from './connectionStatus';

let stopWatch: (() => void) | null = null;
let сетевыеСлушатели: Map<string, Array<() => void>>;

function оборвать(): void {
  eventBus.emit(WS_EVENTS.SOCKET.DISCONNECTED as never, {} as never);
}

function восстановить(): void {
  eventBus.emit(WS_EVENTS.SOCKET.CONNECTED as never, {} as never);
}

function сообщитьОСети(событие: 'online' | 'offline'): void {
  for (const слушатель of сетевыеСлушатели.get(событие) ?? []) слушатель();
}

beforeEach(() => {
  vi.useFakeTimers();
  сетевыеСлушатели = new Map();

  vi.stubGlobal('window', {
    addEventListener: (тип: string, обработчик: () => void) => {
      сетевыеСлушатели.set(тип, [...(сетевыеСлушатели.get(тип) ?? []), обработчик]);
    },
    removeEventListener: (тип: string, обработчик: () => void) => {
      сетевыеСлушатели.set(
        тип,
        (сетевыеСлушатели.get(тип) ?? []).filter((х) => х !== обработчик)
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
    let сообщений = 0;
    subscribeToConnectionStatus(() => {
      сообщений += 1;
    });

    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS - 1);
    восстановить();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('connected');
    expect(сообщений).toBe(0);
  });

  it('should complain when the outage outlasts the delay', () => {
    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('connecting');
  });

  it('should name the trouble the browser reports', () => {
    // Своя сеть отвалилась или сервер не отвечает — это разные беды, и
    // чинить их человеку приходится по-разному.
    vi.stubGlobal('navigator', { onLine: false });

    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('offline');
  });

  it('should complain about a lost network before the socket notices', () => {
    // Браузер, уходя в офлайн, не закрывает уже открытый сокет: тот считает
    // себя живым до самого таймаута, хотя сообщения через него не ходят.
    // Проверено вживую: без этого приложение молчало всё время обрыва.
    vi.stubGlobal('navigator', { onLine: false });
    сообщитьОСети('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    expect(readConnectionStatus()).toBe('offline');
  });

  it('should stop complaining when the network returns and the socket never dropped', () => {
    vi.stubGlobal('navigator', { onLine: false });
    сообщитьОСети('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    vi.stubGlobal('navigator', { onLine: true });
    сообщитьОСети('online');

    expect(readConnectionStatus()).toBe('connected');
  });

  it('should rename the trouble when the network comes back but the server does not', () => {
    vi.stubGlobal('navigator', { onLine: false });
    оборвать();
    сообщитьОСети('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    expect(readConnectionStatus()).toBe('offline');

    vi.stubGlobal('navigator', { onLine: true });
    сообщитьОСети('online');

    // Сеть вернулась, связи всё ещё нет: жалоба остаётся, меняется текст.
    expect(readConnectionStatus()).toBe('connecting');
  });

  it('should not restart the delay when one trouble replaces another', () => {
    // Отсчитывать задержку заново значило бы на две секунды объявить, что
    // всё хорошо, когда это не так.
    vi.stubGlobal('navigator', { onLine: false });
    сообщитьОСети('offline');
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    оборвать();
    vi.stubGlobal('navigator', { onLine: true });
    сообщитьОСети('online');

    expect(readConnectionStatus()).toBe('connecting');
  });

  it('should clear the complaint the moment the connection returns', () => {
    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    expect(readConnectionStatus()).toBe('connecting');

    восстановить();

    expect(readConnectionStatus()).toBe('connected');
  });

  it('should tell its subscriber once per outage', () => {
    let сообщений = 0;
    subscribeToConnectionStatus(() => {
      сообщений += 1;
    });

    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    // Повторные обрывы, пока связи всё нет, ничего не меняют.
    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS * 3);

    expect(сообщений).toBe(1);
  });

  it('should let go of everything when the session ends', () => {
    оборвать();
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);

    stopWatch?.();
    stopWatch = null;

    expect(readConnectionStatus()).toBe('connected');
    expect(сетевыеСлушатели.get('online')).toEqual([]);
    expect(сетевыеСлушатели.get('offline')).toEqual([]);
  });
});
