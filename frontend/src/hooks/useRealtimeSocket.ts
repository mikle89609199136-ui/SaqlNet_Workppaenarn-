import { config } from "@/configs";
import { STORAGE_KEYS } from "@/consts";
import { eventBus } from "@/core";
import { WebSocketClient } from "@/services";
import { useEffect, useMemo } from "react";

let sharedSocket: WebSocketClient | null = null;

interface IUseRealtimeSocketResult {
  eventBus: typeof eventBus;
  socket: WebSocketClient;
}

export function useRealtimeSocket(enabled = true): IUseRealtimeSocketResult {
  const socket = useMemo<WebSocketClient>(() => {
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
