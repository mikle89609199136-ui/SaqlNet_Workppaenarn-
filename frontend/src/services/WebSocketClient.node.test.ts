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

function makeClient() {
  return new WebSocketClient('ws://localhost/ws', {
    getToken: () => 'токен',
    reconnectDelay: 0,
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('window', { location: { href: 'http://localhost/' }, setTimeout: () => 0 });
});

afterEach(() => {
  eventBus.clear();
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
