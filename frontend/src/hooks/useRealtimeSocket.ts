import { config, STORAGE_KEYS } from '@/shared/config';
import { eventBus } from '@/core/EventBus';
import { WebSocketClient } from '@/services/WebSocketClient';
import { useEffect } from 'react';

let sharedSocket: WebSocketClient | null = null;

interface IUseRealtimeSocketResult {
  eventBus: typeof eventBus;
  socket: WebSocketClient;
}

/**
 * Общий клиент. Соединение одно на приложение: несколько подключений от
 * одного пользователя означали бы, что каждое событие обрабатывается по
 * несколько раз.
 */
function sharedRealtimeSocket(): WebSocketClient {
  if (!sharedSocket) {
    sharedSocket = new WebSocketClient(config.socketUrl, {
      getToken: () => window.localStorage.getItem(STORAGE_KEYS.TOKEN),
      reconnectDelay: config.reconnectDelay,
      maxReconnectDelay: config.maxReconnectDelay,
    });
  }

  return sharedSocket;
}

export function useRealtimeSocket(enabled = true): IUseRealtimeSocketResult {
  // Клиент берётся заново на каждом рендере, а не запоминается при первом.
  // Компоненты, живущие выше роутера, не размонтируются при выходе из
  // аккаунта: запомнив прежний экземпляр, они продолжали бы поднимать его
  // соединение поверх нового, и каждое событие приходило бы дважды.
  const socket = sharedRealtimeSocket();

  useEffect(() => {
    if (!enabled) return undefined;

    socket.connect();

    // Соединение общее, поэтому размонтирование одного потребителя его не
    // закрывает: этим распоряжается выход из аккаунта.
    return undefined;
  }, [enabled, socket]);

  return { eventBus, socket };
}

export function disconnectRealtimeSocket() {
  sharedSocket?.disconnect();
  sharedSocket = null;
}

export const resetRealtimeSocketForTests = disconnectRealtimeSocket;
