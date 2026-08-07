import { useEffect, useMemo } from 'react';
import WebSocketClient from '../../infrastructure/websocket/WebSocketClient.js';
import { config } from '../configs/app.js';
import { STORAGE_KEYS } from '../consts/storageKeys.js';
import { eventBus } from '../core/EventBus.js';

let sharedSocket = null;

export function useRealtimeSocket(enabled = true) {
  const socket = useMemo(() => {
    if (!sharedSocket) {
      sharedSocket = new WebSocketClient(config.socketUrl, {
        getToken: () => window.localStorage.getItem(STORAGE_KEYS.TOKEN),
        maxReconnectAttempts: config.maxReconnectAttempts,
        reconnectDelay: config.reconnectDelay,
      });
    }

    return sharedSocket;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    socket.connect();
    return undefined;
  }, [enabled, socket]);

  return { eventBus, socket };
}

export function disconnectRealtimeSocket() {
  sharedSocket?.disconnect();
  sharedSocket = null;
}

export const resetRealtimeSocketForTests = disconnectRealtimeSocket;
