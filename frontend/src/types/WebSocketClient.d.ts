export interface IWebSocketClientOptions {
  getToken?: () => string | null;
  /** Пауза перед первой попыткой переподключиться; дальше она удваивается. */
  reconnectDelay?: number;
  /** Потолок этой паузы. */
  maxReconnectDelay?: number;
}

export default class WebSocketClient {
  constructor(url: string, options?: IWebSocketClientOptions);
  readonly isConnected: boolean;
  connect(): WebSocket | null;
  disconnect(): void;
  send(payload: Record<string, unknown> | string): void;
}
