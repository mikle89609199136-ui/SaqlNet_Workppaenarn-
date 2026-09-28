export const CHAT_ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member',
  OWNER: 'owner',
} as const;

export const CHAT_TYPES = {
  GROUP: 'group',
  PRIVATE: 'private',
} as const;

/**
 * Сколько сообщений принимает одна отправка (#808). Предел сервера: столько
 * же можно выделить и переслать за раз.
 */
export const MAX_MESSAGES_PER_SEND = 100;
