import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketClient } from '@/services/WebSocketClient';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/shared/lib/event-bus';
import { usePushStore } from './pushNotifications';
import { usePushNotifications } from './usePushNotifications';

// Без vi.mock: при isolate:false подмена модуля не срабатывает, если его уже
// загрузил другой тест. Отправка — шпион на прототипе, синхронизация —
// параметр хука.
const noSync = async () => undefined;
let send: ReturnType<typeof vi.spyOn>;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  send = vi.spyOn(WebSocketClient.prototype, 'send').mockImplementation(() => undefined);
  vi.spyOn(WebSocketClient.prototype, 'connect').mockImplementation(() => null);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  usePushStore.setState({ status: 'on', subscriptionId: 'sub-1', busy: false });
});
afterEach(() => vi.restoreAllMocks());

const lastState = () => send.mock.calls.at(-1)?.[0];

/* Серверу — на экране ли приложение этого устройства (#882). */
describe('состояние устройства для push', () => {
  it('сразу, при подключении сокета и при сворачивании — с id подписки', () => {
    renderHook(() => usePushNotifications(true, noSync));
    expect(lastState()).toEqual({
      type: 'client_state',
      visible: true,
      pushSubscriptionId: 'sub-1',
    });

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lastState()).toEqual({
      type: 'client_state',
      visible: false,
      pushSubscriptionId: 'sub-1',
    });

    send.mockClear();
    eventBus.emit(WS_EVENTS.SOCKET.CONNECTED, undefined);
    expect(lastState()).toMatchObject({ type: 'client_state', visible: false });
  });

  it('при входе подписка подтверждается серверу', () => {
    const sync = vi.fn(async () => undefined);
    renderHook(() => usePushNotifications(true, sync));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('сокет ещё не подключён — без исключения; сообщит при подключении', () => {
    send.mockImplementation(() => {
      throw new Error('WebSocket is not connected');
    });
    expect(() => renderHook(() => usePushNotifications(true, noSync))).not.toThrow();
  });

  it('не вошёл — ничего не отправляет и не синхронизирует', () => {
    const sync = vi.fn(async () => undefined);
    renderHook(() => usePushNotifications(false, sync));
    expect(send).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});
