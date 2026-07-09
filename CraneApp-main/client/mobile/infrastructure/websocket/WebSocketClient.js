import { eventBus } from '../../core/EventBus.js';

class WebSocketClient {
  constructor(url, options = {}) {
    this.url = url;
    this.getToken = options.getToken ?? (() => null);
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.socket = null;
    this.reconnectAttempts = 0;
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    this.socket = new WebSocket(this.buildUrl());
    this.socket.addEventListener('open', () => this.handleOpen());
    this.socket.addEventListener('message', (event) => this.handleMessage(event));
    this.socket.addEventListener('close', () => this.handleClose());
    this.socket.addEventListener('error', (event) => eventBus.emit('socket:error', event));

    return this.socket;
  }

  disconnect() {
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.socket?.close();
    this.socket = null;
  }

  send(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    if (typeof payload === 'string') {
      this.socket.send(payload);
    } else {
      this.socket.send(JSON.stringify(payload));
    }
  }

  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  buildUrl() {
    const token = this.getToken();
    if (!token) return this.url;

    const url = new URL(this.url, window.location.href);
    url.searchParams.set('token', token);
    return url.toString();
  }

  handleOpen() {
    this.reconnectAttempts = 0;
    eventBus.emit('socket:connected');
  }

  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      const payload = message.payload ?? message;
      eventBus.emit(message.type, payload);
      eventBus.emit('socket:message', message);
    } catch (error) {
      eventBus.emit('socket:message', event.data);
    }
  }

  handleClose() {
    eventBus.emit('socket:disconnected');

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts += 1;
    window.setTimeout(() => this.connect(), this.reconnectDelay);
  }
}

export default WebSocketClient;
