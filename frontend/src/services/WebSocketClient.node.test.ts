import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/shared/lib/event-bus';
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
interface ScheduledTimer {
  delay: number;
  run: () => void;
  cancelled: boolean;
  fired: boolean;
}

let timers: ScheduledTimer[] = [];
let listeners: Map<string, Array<() => void>>;
let visibility: 'visible' | 'hidden';

function makeClient(options: Record<string, unknown> = {}) {
  return new WebSocketClient('ws://localhost/ws', {
    hasSession: () => true,
    reconnectDelay: 0,
    ...options,
  });
}

/** Попытка, которая назначена и ещё ждёт своего часа. */
function scheduled(): ScheduledTimer | undefined {
  return timers.filter((timer) => !timer.cancelled && !timer.fired).at(-1);
}

function wake(event: 'online' | 'visibilitychange'): void {
  for (const listener of listeners.get(event) ?? []) listener();
}

beforeEach(() => {
  FakeSocket.instances = [];
  timers = [];
  listeners = new Map();
  visibility = 'visible';

  const addEventListener = (type: string, handler: () => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), handler]);
  };

  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('window', {
    location: { href: 'http://localhost/' },
    setTimeout: (handler: () => void, delay: number) => {
      const timer: ScheduledTimer = {
        delay,
        cancelled: false,
        fired: false,
        run: () => {
          timer.fired = true;
          handler();
        },
      };
      timers.push(timer);
      return timers.length;
    },
    clearTimeout: (id: number) => {
      const timer = timers[id - 1];
      if (timer) timer.cancelled = true;
    },
    addEventListener,
    removeEventListener: (type: string, handler: () => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((fn) => fn !== handler)
      );
    },
  });
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
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

    const first = client.connect() as unknown as FakeSocket;
    first.open();

    first.close();
    const second = client.connect() as unknown as FakeSocket;

    expect(second).not.toBe(first);

    second.open();
    first.finishClosing();

    // Клиент по-прежнему считает связь живой: закрылось не то соединение.
    expect(client.isConnected).toBe(true);
  });

  it('should ignore messages from a socket it no longer owns', () => {
    // Брошенное соединение продолжает получать трафик, пока не закроется.
    // Каждое такое сообщение — ещё одна расшифровка и ещё одна запись.
    const client = makeClient();
    const received: unknown[] = [];
    eventBus.on('new_message' as never, (payload: unknown) => received.push(payload));

    const first = client.connect() as unknown as FakeSocket;
    first.open();
    first.close();

    const second = client.connect() as unknown as FakeSocket;
    second.open();

    first.deliver({ type: 'new_message', payload: { id: 'из брошенного' } });
    second.deliver({ type: 'new_message', payload: { id: 'из текущего' } });

    expect(received).toEqual([{ id: 'из текущего' }]);
  });

  it('should close a socket that connects after being abandoned', () => {
    // Соединение могло установиться уже после того, как клиент переключился
    // на другое: без явного закрытия оно осталось бы жить без владельца.
    const client = makeClient();

    const first = client.connect() as unknown as FakeSocket;
    first.close();

    const second = client.connect() as unknown as FakeSocket;
    second.open();

    first.open();

    expect(first.closeCalls).toBeGreaterThan(1);
    expect(client.isConnected).toBe(true);
  });

  it('should announce disconnect only for the socket in use', () => {
    const client = makeClient();
    let announcements = 0;
    eventBus.on('socket:disconnected' as never, () => {
      announcements += 1;
    });

    const first = client.connect() as unknown as FakeSocket;
    first.open();
    first.close();

    const second = client.connect() as unknown as FakeSocket;
    second.open();

    first.finishClosing();

    expect(announcements).toBe(0);
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
    const first = client.connect() as unknown as FakeSocket;
    first.open();
    first.close();

    const second = client.connect() as unknown as FakeSocket;
    second.open();

    first.deliver({ type: 'ping' });

    expect(first.sent).toEqual([]);
  });

  it('should keep passing the ping to subscribers', () => {
    // Событие остаётся в общей шине: она сама решает, что с ним делать.
    const client = makeClient();
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    let heard = 0;
    eventBus.on('ping' as never, () => {
      heard += 1;
    });

    socket.deliver({ type: 'ping' });

    expect(heard).toBe(1);
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

    for (let attempt = 0; attempt < 20; attempt += 1) {
      socket.finishClosing();
      scheduled()?.run();
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

    const pauses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      socket.finishClosing();
      const timer = scheduled();
      pauses.push(timer?.delay ?? -1);
      timer?.run();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }

    expect(pauses).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('should start counting from scratch after a successful connection', () => {
    const client = makeClient({ reconnectDelay: 1000 });
    let socket = client.connect() as unknown as FakeSocket;
    socket.open();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      socket.finishClosing();
      scheduled()?.run();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }

    socket.open();
    socket.finishClosing();

    expect(scheduled()?.delay).toBe(1000);
  });

  it('should not schedule a second attempt while one is pending', () => {
    // Два таймера означали бы два соединения.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    socket.finishClosing();
    socket.finishClosing();

    expect(timers.filter((timer) => !timer.cancelled && !timer.fired)).toHaveLength(1);
  });

  it('should stop reconnecting after a deliberate disconnect', () => {
    // Выход из аккаунта: возвращаться некуда и незачем.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    client.disconnect();
    socket.finishClosing();

    expect(scheduled()).toBeUndefined();
  });

  it('should try at once when the network comes back', () => {
    // Пауза к этому моменту могла вырасти до получаса ожидания на двоих:
    // человек видит, что сеть вернулась, а приложение — ещё нет.
    const client = makeClient({ reconnectDelay: 1000 });
    let socket = client.connect() as unknown as FakeSocket;
    socket.open();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      socket.finishClosing();
      scheduled()?.run();
      socket = FakeSocket.instances.at(-1) as FakeSocket;
    }
    socket.finishClosing();
    expect(scheduled()?.delay).toBe(30000);

    const socketsBefore = FakeSocket.instances.length;
    wake('online');

    expect(FakeSocket.instances.length).toBe(socketsBefore + 1);
    expect(scheduled()).toBeUndefined();
  });

  it('should try at once when the tab comes back', () => {
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    socket.finishClosing();

    const socketsBefore = FakeSocket.instances.length;
    wake('visibilitychange');

    expect(FakeSocket.instances.length).toBe(socketsBefore + 1);
  });

  it('should leave a hidden tab alone', () => {
    // Событие приходит и когда вкладку прячут: тогда пробовать незачем.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    socket.finishClosing();

    visibility = 'hidden';
    const socketsBefore = FakeSocket.instances.length;
    wake('visibilitychange');

    expect(FakeSocket.instances.length).toBe(socketsBefore);
  });

  it('should drop a connection still hanging from the outage', () => {
    // Соединение, начатое без сети, браузер признает мёртвым нескоро, а
    // клиент считает его живым и новое не открывает.
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    socket.finishClosing();

    // Назначенная попытка сработала, но соединение так и висит.
    scheduled()?.run();
    const hanging = FakeSocket.instances.at(-1) as FakeSocket;
    expect(hanging.readyState).toBe(FakeSocket.CONNECTING);

    wake('online');

    expect(hanging.closeCalls).toBe(1);
    expect(FakeSocket.instances.at(-1)).not.toBe(hanging);
  });

  it('should not wake up after a deliberate disconnect', () => {
    const client = makeClient({ reconnectDelay: 1000 });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    client.disconnect();

    const socketsBefore = FakeSocket.instances.length;
    wake('online');

    expect(FakeSocket.instances.length).toBe(socketsBefore);
  });

  it('сохраняет контекст from и roomId для событий звонков call_*', () => {
    const client = makeClient();
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    const received: unknown[] = [];
    const unsub = eventBus.on('call_offer', (data) => received.push(data));

    socket.deliver({
      type: 'call_offer',
      from: 'user-alice',
      roomId: 'room-123',
      payload: { sdp: 'test-sdp', type: 'offer' },
    });

    unsub();

    expect(received).toEqual([
      {
        sdp: 'test-sdp',
        type: 'offer',
        from: 'user-alice',
        roomId: 'room-123',
      },
    ]);
  });

  it('игнорирует payload.from и берёт from только с верхнего уровня для call_* (#854)', () => {
    const client = makeClient();
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();

    const received: unknown[] = [];
    const unsub = eventBus.on('call_offer', (data) => received.push(data));

    socket.deliver({
      type: 'call_offer',
      roomId: 'room-123',
      payload: { sdp: 'test-sdp', type: 'offer', from: 'user-mallory' },
    });

    unsub();

    expect(received).toEqual([
      {
        sdp: 'test-sdp',
        type: 'offer',
        from: undefined,
        roomId: 'room-123',
      },
    ]);
  });
});

/* Сессия — в cookie (#705): браузер отправит её при подключении сам. */
describe('подключение по cookie сессии', () => {
  it('в адресе нет токена', () => {
    makeClient().connect();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe('ws://localhost/ws');
  });

  it('человек не вошёл — не подключается', () => {
    expect(makeClient({ hasSession: () => false }).connect()).toBeNull();
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

/* Соединение, которое молчит, мёртвое (#1069): браузер признаёт это
   нескоро, а шапка всё это время показывала бы «на связи». */
describe('сторожевой таймер соединения', () => {
  const LIVENESS = 60_000;
  const PROBE = 10_000;

  /** Ещё не сработавшие таймеры тишины — по их длительности. */
  const pending = (delay: number) =>
    timers.filter((timer) => timer.delay === delay && !timer.cancelled && !timer.fired);

  function connected() {
    const client = makeClient({ livenessTimeout: LIVENESS, probeTimeout: PROBE });
    const socket = client.connect() as unknown as FakeSocket;
    socket.open();
    return { client, socket };
  }

  it('60 с тишины после открытия — старое закрыто, новое создано, обрыв объявлен один раз', () => {
    const { socket } = connected();
    const disconnected = vi.fn();
    eventBus.on('socket:disconnected', disconnected);

    expect(pending(LIVENESS)).toHaveLength(1);
    pending(LIVENESS)[0].run();

    expect(socket.closeCalls).toBe(1);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('любое входящее перезаводит таймер', () => {
    const { socket } = connected();
    const [first] = pending(LIVENESS);

    socket.deliver({ type: 'ping' });
    expect(first.cancelled).toBe(true);
    expect(pending(LIVENESS)).toHaveLength(1);

    socket.deliver({ type: 'new_message', payload: {} });
    expect(pending(LIVENESS)).toHaveLength(1);
  });

  it('после закрытия и после disconnect таймера нет', () => {
    const { client, socket } = connected();
    socket.finishClosing();
    expect(pending(LIVENESS)).toHaveLength(0);

    const next = client.connect() as unknown as FakeSocket;
    next.open();
    client.disconnect();
    expect(pending(LIVENESS)).toHaveLength(0);
  });

  it('брошенное по таймеру соединение позже закрывается — новое остаётся текущим', () => {
    const { client, socket } = connected();
    const disconnected = vi.fn();
    eventBus.on('socket:disconnected', disconnected);
    pending(LIVENESS)[0].run();
    const fresh = FakeSocket.instances.at(-1)!;
    fresh.open();

    socket.finishClosing();

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(client.isConnected).toBe(true);
  });

  it('возврат сети при открытом соединении — ping и короткое ожидание ответа', () => {
    const { socket } = connected();

    wake('online');

    expect(socket.sent).toEqual([JSON.stringify({ type: 'ping' })]);
    expect(pending(PROBE)).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(1);

    socket.deliver({ type: 'pong' });
    expect(pending(PROBE)).toHaveLength(0);
    expect(pending(LIVENESS)).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('на ping нет ответа — переподключение', () => {
    const { socket } = connected();

    wake('online');
    pending(PROBE)[0].run();

    expect(socket.closeCalls).toBe(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('возврат во вкладку — тоже проверка; скрытая вкладка — нет', () => {
    const { socket } = connected();

    visibility = 'hidden';
    wake('visibilitychange');
    expect(socket.sent).toEqual([]);

    visibility = 'visible';
    wake('visibilitychange');
    expect(socket.sent).toEqual([JSON.stringify({ type: 'ping' })]);
  });

  it('сообщение без соединения таймеров не заводит', () => {
    const client = makeClient({ livenessTimeout: LIVENESS });

    client.handleMessage({ data: JSON.stringify({ type: 'ping' }) });

    expect(pending(LIVENESS)).toHaveLength(0);
  });
});
