export interface IWebSocketClientOptions {
  getToken: () => string | null;
  maxReconnectAttempts: number;
  reconnectDelay: number;
}

export default class WebSocketClient {
  constructor(url: string, options: IWebSocketClientOptions);
  readonly isConnected: boolean;
  connect(): void;
  disconnect(): void;
  send(payload: Record<string, unknown>): void;
}
