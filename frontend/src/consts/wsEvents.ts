export const WS_EVENTS = {
  MESSAGE: {
    NEW: 'new_message',
    EDITED: 'message_edited',
    DELETED: 'message_deleted',
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
    ADD_MEMBER: 'add_chat_member',
    UPDATED: 'chat_updated',
  },
  REACTIONS: {
    REACTION_UPDATED: 'reaction_updated',
  },
  USER: {
    TYPING: 'typing',
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
