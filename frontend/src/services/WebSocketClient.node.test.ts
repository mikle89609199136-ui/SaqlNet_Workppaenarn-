import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core';
import { WebSocketClient } from './WebSocketClient';

/**
 * Управляемое соединение: тест сам решает, когда оно откроется и закроется.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  closeCalls = 0;
  sent: string[] = [];

  private listeners = new Map<string, Array<(event: unknown) => void>>();

  url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const forType = this.listeners.get(type) ?? [];
    forType.push(handler);
    this.listeners.set(type, forType);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeSocket.CLOSING;
  }

  /** Соединение установлено. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.fire('open', {});
  }

  /** Соединение оборвалось. */
  finishClosing(): void {
    this.readyState = FakeSocket.CLOSED;
    this.fire('close', {});
  }

  deliver(message: unknown): void {
    this.fire('message', { data: JSON.stringify(message) });
  }

  private fire(type: string, event: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

/** Назначенная, но ещё не сработавшая попытка переподключиться. */
interface Таймер {
  задержка: number;
  запустить: () => void;
  отменён: boolean;
  сработал: boolean;
}

let таймеры: Таймер[] = [];
let слушатели: Map<string, Array<() => void>>;
let видимость: 'visible' | 'hidden';

function makeClient(options: Record<string, unknown> = {}) {
  return new WebSocketClient('ws://localhost/ws', {
    getToken: () => 'токен',
    reconnectDelay: 0,
    ...options,
  });
}

/** Попытка, которая назначена и ещё ждёт своего часа. */
function назначено(): Таймер | undefined {
  return таймеры.filter((т) => !т.отменён && !т.сработал).at(-1);
}

function разбудить(событие: 'online' | 'visibilitychange'): void {
  for (const слушатель of слушатели.get(событие) ?? []) слушатель();
}

beforeEach(() => {
  FakeSocket.instances = [];
  таймеры = [];
  слушатели = new Map();
  видимость = 'visible';

  const addEventListener = (тип: string, обработчик: () => void) => {
    слушатели.set(тип, [...(слушатели.get(тип) ?? []), обработчик]);
  };

  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('window', {
    location: { href: 'http://localhost/' },
    setTimeout: (обработчик: () => void, задержка: number) => {
      const таймер: Таймер = {
        задержка,
        отменён: false,
        сработал: false,
        запустить: () => {
          таймер.сработал = true;
          обработчик();
        },
      };
      таймеры.push(таймер);
      return таймеры.length;
    },
    clearTimeout: (id: number) => {
      const таймер = таймеры[id - 1];
      if (таймер) таймер.отменён = true;
    },
    addEventListener,
    removeEventListener: (тип: string, обработчик: () => void) => {
      слушатели.set(
        тип,
        (слушатели.get(тип) ?? []).filter((х) => х !== обработчик)
      );
    },
  });
  vi.stubGlobal('document', {
    get visibilityState() {
      return видимость;
    },
    addEventListener,
    removeEventListener: () => {},
  });

  // Разброс паузы выключен: тест проверяет её рост, а не случайность.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('смена соединения', () => {
  it('should keep the new socket when the previous one finishes closing', () => {
    // Гонка: старое соединение ещё закрывается, когда открывается новое.
    // Раньше событие close старого обнуляло ссылку на живое новое, и
    // закрыть его после этого было уже некому.
    const client = makeClient();

    const первый = client.connect() as unknown as FakeSocket;
    первый.open();

    первый.close();
    const второй = client.connect() as unknown as FakeSocket;

    expect(второй).not.toBe(первый);

    второй.open();
    первый.finishClosing();

    // Клиент по-прежнему считает связь живой: закрылось не то соединение.
    expect(client.isConnected).toBe(true);
  });

  it('should ignore messages from a socket it no longer owns', () => {
    // Брошенное соединение продолжает получать трафик, пока не закроется.
    // Каждое такое сообщение — ещё одна расшифровка и ещё одна запись.
    const client = makeClient();
    const received: unknown[] = [];
    eventBus.on('new_message' as never, (payload: unknown) => received.push(payload));

    const первый = client.connect() as unknown as FakeSocket;
    первый.open();
    первый.close();

    const второй = client.connect() as unknown as FakeSocket;
    второй.open();

    первый.deliver({ type: 'new_message', payload: { id: 'из брошенного' } });
    второй.deliver({ type: 'new_message', payload: { id: 'из текущего' } });

    expect(received).toEqual([{ id: 'из текущего' }]);
  });

  it('should close a socket that connects after being abandoned', () => {
    // Соединение могло установиться уже после того, как клиент переключился
    // на другое: без явного закрытия оно осталось бы жить без владельца.
    const client = makeClient();

    const первый = client.connect() as unknown as FakeSocket;
    первый.close();

    const второй = client.connect() as unknown as FakeSocket;
    второй.open();

    первый.open();

    expect(первый.closeCalls).toBeGreaterThan(1);
    expect(client.isConnected).toBe(true);
  });

  it('should announce disconnect only for the socket in use', () => {
    const client = makeClient();
    let объявлений = 0;
    eventBus.on('socket:disconnected' as never, () => {
      объявлений += 1;
    });

    const первый = client.connect() as unknown as FakeSocket;
    первый.open();
    первый.close();

    const второй = client.connect() as unknown as FakeSocket;
    второй.open();

    первый.finishClosing();

    expect(объявлений).toBe(0);
  });
});

describe('сердцебиение', () => {
  it('should answer the server ping', () => {
    // Сервер держит соединение, пока клиент хоть что-то присылает, и рвёт
    // молчащего через полторы минуты. Проверено на живом стенде: соединение
    // без ответов закрывается на сотой секунде с кодом 1006.
    const client = makeClient();
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    socket.deliver({ type: 'ping' });

    expect(socket.sent).toEqual([JSON.stringify({ type: 'pong' })]);
  });

  it('should not answer a ping from a socket it no longer owns', () => {
    const client = makeClient();
    const первый = client.connect() as unknown as FakeSocket;
    первый.open();
    первый.close();

    const второй = client.connect() as unknown as FakeSocket;
    второй.open();

    первый.deliver({ type: 'ping' });

    expect(первый.sent).toEqual([]);
  });

  it('should keep passing the ping to subscribers', () => {
    // Событие остаётся в общей шине: она сама решает, что с ним делать.
    const client = makeClient();
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    let услышано = 0;
    eventBus.on('ping' as never, () => {
      услышано += 1;
    });

    socket.deliver({ type: 'ping' });

    expect(услышано).toBe(1);
  });
});

describe('переподключение', () => {
  it('should keep trying long after the old five attempts ran out', () => {
    // Прежний клиент делал пять попыток раз в секунду и после этого молчал
    // до перезагрузки страницы. Пятисекундной ямы в метро хватало, чтобы
    // остаться без сообщений до конца сессии.
    const client = makeClient({ reconnectDelay: 1000 });
    let socket = client.connect() as unknown as FakeSocket;
    socket.open();

    for (let попытка = 0; попытка < 20; попытка += 1) {
      socket.finishClosing();
      назначено()?.запустить();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }

    expect(FakeSocket.instances).toHaveLength(21);
  });

  it('should double the pause up to the ceiling', () => {
    // Недоступный сервер не должен получать шквал запросов, а вернувшийся —
    // отвечать быстро: первая попытка идёт через секунду.
    const client = makeClient({ reconnectDelay: 1000, maxReconnectDelay: 30000 });
    let socket = client.connect() as unknown as FakeSocket;
    socket.open();

    const паузы: number[] = [];
    for (let попытка = 0; попытка < 7; попытка += 1) {
      socket.finishClosing();
      const таймер = назначено();
      паузы.push(таймер?.задержка ?? -1);
      таймер?.запустить();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }

    expect(паузы).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('should start counting from scratch after a successful connection', () => {
    const client = makeClient({ reconnectDelay: 1000 });
    let socket = client.connect() as unknown as FakeSocket;
    socket.open();

    for (let попытка = 0; попытка < 3; попытка += 1) {
      socket.finishClosing();
      назначено()?.запустить();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }

    socket.open();
    socket.finishClosing();

    expect(назначено()?.задержка).toBe(1000);
  });

  it('should not schedule a second attempt while one is pending', () => {
    // Два таймера означали бы два соединения.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    socket.finishClosing();
    socket.finishClosing();

    expect(таймеры.filter((т) => !т.отменён && !т.сработал)).toHaveLength(1);
  });

  it('should stop reconnecting after a deliberate disconnect', () => {
    // Выход из аккаунта: возвращаться некуда и незачем.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    client.disconnect();
    socket.finishClosing();

    expect(назначено()).toBeUndefined();
  });

  it('should try at once when the network comes back', () => {
    // Пауза к этому моменту могла вырасти до получаса ожидания на двоих:
    // человек видит, что сеть вернулась, а приложение — ещё нет.
    const client = makeClient({ reconnectDelay: 1000 });
    let socket = client.connect() as unknown as FakeSocket;
    socket.open();

    for (let попытка = 0; попытка < 6; попытка += 1) {
      socket.finishClosing();
      назначено()?.запустить();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }
    socket.finishClosing();
    expect(назначено()?.задержка).toBe(30000);

    const былоСоединений = FakeSocket.instances.length;
    разбудить('online');

    expect(FakeSocket.instances.length).toBe(былоСоединений + 1);
    expect(назначено()).toBeUndefined();
  });

  it('should try at once when the tab comes back', () => {
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    socket.finishClosing();

    const былоСоединений = FakeSocket.instances.length;
    разбудить('visibilitychange');

    expect(FakeSocket.instances.length).toBe(былоСоединений + 1);
  });

  it('should leave a hidden tab alone', () => {
    // Событие приходит и когда вкладку прячут: тогда пробовать незачем.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    socket.finishClosing();

    видимость = 'hidden';
    const былоСоединений = FakeSocket.instances.length;
    разбудить('visibilitychange');

    expect(FakeSocket.instances.length).toBe(былоСоединений);
  });

  it('should drop a connection still hanging from the outage', () => {
    // Соединение, начатое без сети, браузер признает мёртвым нескоро, а
    // клиент считает его живым и новое не открывает.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    socket.finishClosing();

    // Назначенная попытка сработала, но соединение так и висит.
    назначено()?.запустить();
    const зависшее = FakeSocket.instances.at(-1) as FakeSocket;
    expect(зависшее.readyState).toBe(FakeSocket.CONNECTING);

    разбудить('online');

    expect(зависшее.closeCalls).toBe(1);
    expect(FakeSocket.instances.at(-1)).not.toBe(зависшее);
  });

  it('should not wake up after a deliberate disconnect', () => {
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    client.disconnect();

    const былоСоединений = FakeSocket.instances.length;
    разбудить('online');

    expect(FakeSocket.instances.length).toBe(былоСоединений);
  });
});
