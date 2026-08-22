export const API_ENDPOINTS = {
  AUTH_SEND_CODE: "/auth/send-code",
  AUTH_VERIFY_CODE: "/auth/verify-code",
  AUTH_REGISTER: "/auth/register",
  AUTH_LOGIN: "/auth/login",
  AUTH_LOGOUT: "/auth/logout",
  AUTH_RESEND_CODE: "/auth/resend-code",
  AUTH_VALIDATE: "/auth/validate",
  AUTH_PUBLIC_KEY: "/auth/public-key",

  USERS_ME: "/users/me",
  USERS_AVATAR: "/users/avatar",
  CHATS: "/chats",
  CHAT_PRIVATE: "/chats/private",
  CHAT_GROUPS: "/chats/groups",
  CHAT_BY_ID: (chatId: string) => `/chats/${chatId}`,
  CHAT_MEMBERS: (chatId: string) => `/chats/${chatId}/members`,
  CHAT_MEMBER: (chatId: string, userId: string) =>
    `/chats/${chatId}/members/${userId}`,
  CHAT_MEMBER_ROLE: (chatId: string, userId: string) =>
    `/chats/${chatId}/members/${userId}/role`,
  CHAT_MUTE: (chatId: string) => `/chats/${chatId}/mute`,
  CHAT_PIN: (chatId: string) => `/chats/${chatId}/pin`,
  CHAT_ARCHIVE: (chatId: string) => `/chats/${chatId}/archive`,

  USER_SEARCH: "/users/search",
  USER_PROFILE: (userId: string) => `/users/${userId}/profile`,
  USER_SETTINGS: "/users/settings",
  USER_PRIVACY: "/users/privacy",
  USER_NOTIFICATIONS: "/users/notifications",
  USER_SOUNDS: "/users/sounds",
  USER_ADVANCED_SETTINGS: "/users/advanced-settings",
  USER_FOLDERS: "/users/folders",
  USER_STORAGE: "/users/storage",
  USER_STORAGE_SETTINGS: "/users/storage/settings",
  USER_STORAGE_CACHE: "/users/storage/cache",
  USER_STORAGE_ALL: "/users/storage/all",
  USER_EXPORT: "/users/export",
  USER_BLOCKED: "/users/blocked",
  USER_BLOCKED_BY_ID: (userId: string) => `/users/blocked/${userId}`,
  USER_DEVICES: "/users/devices",
  USER_DEVICE_REGISTER: "/users/devices/register",
  USER_DEVICE_DELETE: (sessionId: string) => `/users/devices/${sessionId}`,
  USER_DEVICES_TERMINATE_ALL: "/users/devices/terminate-all",

  MESSAGES: (chatId: string) => `/messages/${chatId}`,
  MESSAGE_SEND: (chatId: string) => `/messages/${chatId}`,
  MESSAGE_BY_ID: (messageId: string) => `/messages/${messageId}`,
  MESSAGE_READ: "/messages/read",
  MESSAGE_FORWARD: (messageId: string) => `/messages/${messageId}/forward`,
  MESSAGE_REACT: (messageId: string) => `/messages/${messageId}/reactions`,
  MESSAGE_REACTIONS: (messageId: string) => `/messages/${messageId}/reactions`,

  CHAT_PINS: (chatId: string) => `/chats/${chatId}/pins`,
  CHAT_PIN_MESSAGE: (chatId: string, messageId: string) =>
    `/chats/${chatId}/pins/${messageId}`,

  MEDIA_UPLOAD: "/media",
  MEDIA_GET: (uploadId: string) => `/media/${uploadId}`,

  ADMIN_USERS: "/admin/users",
  ADMIN_USER_DISABLE: (userId: string) => `/admin/users/${userId}/disable`,
  ADMIN_USER_ENABLE: (userId: string) => `/admin/users/${userId}/enable`,
  ADMIN_REPORTS: "/admin/reports",
  ADMIN_REPORT_RESOLVE: (reportId: string) =>
    `/admin/reports/${reportId}/resolve`,

  CALL_ROOMS: "/calls/rooms",
  EMOJIS: "/emojis",
};

export default API_ENDPOINTS;
