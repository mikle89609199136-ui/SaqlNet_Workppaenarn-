/**
 * WebSocket Provider
 * Manages real-time connections
 */

import { config } from '../config.js';
import { authStore } from '../../store/authStore.js';
import { socketClient } from '../../services/socket/socketClient.js';

export const socketProvider = {
  initialized: false,
  connected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,

  async init() {
    if (this.initialized) return;

    try {
      await this.connect();
      this.initialized = true;
    } catch (error) {
      console.error('Socket provider init error:', error);
      this.scheduleReconnect();
    }
  },

  async connect() {
    const token = authStore.getToken();
    
    if (!token) {
      console.warn('No auth token, skipping socket connection');
      return;
    }

    try {
      await socketClient.connect(config.socketUrl, token);
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('✅ WebSocket connected');
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      this.scheduleReconnect();
      throw error;
    }
  },

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  },

  disconnect() {
    socketClient.disconnect();
    this.connected = false;
  },

  isConnected() {
    return this.connected && socketClient.isConnected();
  },

  send(type, payload) {
    if (this.isConnected()) {
      socketClient.send({ type, payload });
    } else {
      console.warn('Socket not connected, message queued');
    }
  }
};