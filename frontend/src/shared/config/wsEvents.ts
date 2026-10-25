export const WS_EVENTS = {
  MESSAGE: {
    NEW: 'new_message',
    EDITED: 'message_edited',
    DELETED: 'message_deleted',
    // Пачка удалена у всех / скрыта у себя (#840).
    BATCH_DELETED: 'messages_deleted',
    HIDDEN: 'messages_hidden',
    // Собеседник получил или прочитал сообщения до upTo (#657).
    RECEIPTS: 'receipts',
    PINNED: 'message_pinned',
    UNPINNED: 'message_unpinned',
  },
  SOCKET: {
    CONNECTED: 'socket:connected',
    DISCONNECTED: 'socket:disconnected',
    ERROR: 'socket:error',
    MESSAGE: 'socket:message',
  },
  CHAT: {
    // Имена сверены с backend-v2/internal/chat/service.go: прежнее
    // 'add_chat_member' сервер не присылал никогда.
    MEMBER_ADDED: 'chat_member_added',
    MEMBER_REMOVED: 'chat_member_removed',
    MEMBER_ROLE_UPDATED: 'chat_member_role_updated',
    UPDATED: 'chat_updated',
  },
  REACTIONS: {
    REACTION_UPDATED: 'reaction_updated',
  },
  USER: {
    TYPING: 'typing',
    // Собеседник вошёл в сеть или вышел из неё (#780).
    PRESENCE: 'presence_changed',
    // Блокировка и её снятие — приходят обоим (#760).
    BLOCKED: 'user_blocked',
    UNBLOCKED: 'user_unblocked',
    PROFILE_UPDATED: 'user_profile_updated',
    SETTINGS_UPDATED: 'settings_updated',
  },
  CALL: {
    ERROR: 'call_error',
    JOINED: 'call_joined',
    PEER_JOINED: 'call_peer_joined',
    PEER_LEFT: 'call_peer_left',
    INCOMING: 'call_incoming',
    CANCELED: 'call_cancelled',
    INVITE_RESPONSE: 'call_invite_response',
    OFFER: 'call_offer',
    ANSWER: 'call_answer',
    ICE: 'call_ice',
  },
  OTHER: {
    PING: 'ping',
    PONG: 'pong',
  },
} as const;
