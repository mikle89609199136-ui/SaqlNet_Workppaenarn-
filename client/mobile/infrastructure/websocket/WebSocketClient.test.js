import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../core/EventBus.js';
import WebSocketClient from './WebSocketClient.js';

describe('WebSocketClient', () => {
  afterEach(() => {
    eventBus.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('uses the bearer token when building the gateway URL', () => {
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'user-1' }));
    const client = new WebSocketClient('ws://localhost:8080/ws', {
      getToken: () => 'token',
    });

    expect(client.buildUrl()).toBe('ws://localhost:8080/ws?token=token');
  });

  it('does not create another socket while the first one is connecting', () => {
    const OriginalWebSocket = globalThis.WebSocket;
    const sockets = [];
    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.addEventListener = vi.fn();
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new WebSocketClient('ws://localhost:8080/ws');
    const first = client.connect();
    const second = client.connect();

    expect(first).toBe(second);
    expect(sockets).toHaveLength(1);

    vi.stubGlobal('WebSocket', OriginalWebSocket);
  });

  it('emits gateway messages without payload as event payload', () => {
    const client = new WebSocketClient('ws://localhost:8080/ws');
    const handler = vi.fn();
    eventBus.on('new_message', handler);

    client.handleMessage({
      data: JSON.stringify({
        type: 'new_message',
        chatId: 'chat-1',
        message: { id: 'm1', content: 'Hello' },
      }),
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      message: expect.objectContaining({ content: 'Hello' }),
    }));
  });

  it('still supports messages with payload', () => {
    const client = new WebSocketClient('ws://localhost:8080/ws');
    const handler = vi.fn();
    eventBus.on('socket_event', handler);

    client.handleMessage({
      data: JSON.stringify({
        type: 'socket_event',
        payload: { ok: true },
      }),
    });

    expect(handler).toHaveBeenCalledWith({ ok: true });
  });
});
