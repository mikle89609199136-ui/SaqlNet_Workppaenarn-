import { eventBus } from '@/core';

export class WebSocketClient {
  constructor(url, options = {}) {
    this.url = url;
    this.getToken = options.getToken ?? (() => null);
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.socket = null;
    this.reconnectAttempts = 0;
  }

  connect() {
    const token = this.getToken();
    if (!token) {
      return null;
    }
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return this.socket;
    }

    // Каждый обработчик знает, какому соединению он принадлежит, и молчит,
    // если клиент успел переключиться на другое. Иначе события уходящего
    // соединения распоряжаются текущим: закрытие старого обнуляло ссылку
    // на живое новое, и закрыть его после этого было уже некому.
    const socket = new WebSocket(this.buildUrl(token));
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        // Соединение установилось, когда его уже бросили: без этого оно
        // осталось бы открытым навсегда и продолжало принимать трафик.
        socket.close();
        return;
      }

      this.handleOpen();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event);
    });

    socket.addEventListener('close', () => this.handleClose(socket));

    socket.addEventListener('error', (event) => {
      if (this.socket !== socket) return;
      eventBus.emit('socket:error', event);
    });

    return socket;
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

  buildUrl(token = this.getToken()) {
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

  handleClose(socket = this.socket) {
    // Закрылось не то соединение, которым клиент пользуется сейчас:
    // ни ссылку обнулять, ни переподключаться не нужно.
    if (this.socket !== socket) return;

    this.socket = null;
    eventBus.emit('socket:disconnected');

    if (!this.getToken()) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts += 1;
    window.setTimeout(() => this.connect(), this.reconnectDelay);
  }
}
