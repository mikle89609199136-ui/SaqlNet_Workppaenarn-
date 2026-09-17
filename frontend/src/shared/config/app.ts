const envApiBaseUrl = import.meta.env?.VITE_API_BASE_URL;
const envSocketUrl = import.meta.env?.VITE_SOCKET_URL;

// Адреса вычисляются при обращении, а не при импорте модуля: иначе файл
// нельзя импортировать вне браузера — например, в тестах без DOM.
function resolveApiBaseUrl(): string {
  if (envApiBaseUrl) return envApiBaseUrl;
  const origin = globalThis.location?.origin;
  return origin ? `${origin}/api/v2` : '/api/v2';
}

function resolveSocketUrl(): string {
  if (envSocketUrl) return envSocketUrl;
  const location = globalThis.location;
  if (!location) return '/ws';
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

export const config = {
  version: '1.0.0',
  appName: 'CraneApp',

  // API Configuration
  get apiBaseUrl() {
    return resolveApiBaseUrl();
  },

  // WebSocket Configuration
  get socketUrl() {
    return resolveSocketUrl();
  },

  // Media Configuration
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  allowedVideoTypes: ['video/mp4', 'video/webm'],
  allowedAudioTypes: ['audio/ogg', 'audio/webm', 'audio/mp3', 'audio/m4a'],

  // UI Configuration
  messagesPerPage: 50,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,

  // Feature Flags
  features: {
    voiceCalls: true,
    videoCalls: true,
    e2eEncryption: false, // Not implemented yet
    aiAssistant: true,
    stickers: true,
    channels: true,
  },
};
