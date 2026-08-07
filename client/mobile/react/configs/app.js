const envApiBaseUrl = import.meta.env?.VITE_API_BASE_URL;
const envSocketUrl = import.meta.env?.VITE_SOCKET_URL;

export const config = {
  version: '1.0.0',
  appName: 'CraneApp',

  // API Configuration
  apiBaseUrl: envApiBaseUrl || `${window.location.origin}/api/v2`,

  // WebSocket Configuration
  socketUrl: envSocketUrl || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,

  // Media Configuration
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  allowedVideoTypes: ['video/mp4', 'video/webm'],
  allowedAudioTypes: ['audio/ogg', 'audio/webm', 'audio/mp3', 'audio/m4a'],

  // UI Configuration
  messagesPerPage: 50,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,

  // Feature Flags
  features: {
    voiceCalls: true,
    videoCalls: true,
    e2eEncryption: false, // Not implemented yet
    aiAssistant: true,
    stickers: true,
    channels: true
  }
};
