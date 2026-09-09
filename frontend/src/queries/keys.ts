/**
 * Ключи запросов.
 *
 * Иерархия здесь не украшение: сброс по префиксу `chatKeys.detail(id)`
 * инвалидирует и сам чат, и его историю, и закреплённые — одной строкой.
 * Это понадобится, например, при смене ключей шифрования, когда весь
 * расшифрованный кеш чата разом становится неверным.
 *
 * `as const` обязателен: без него TypeScript выведет `string[]`, и опечатка
 * в ключе перестанет быть ошибкой типов.
 */
export const chatKeys = {
  all: ['chat'] as const,
  list: () => [...chatKeys.all, 'list'] as const,
  archived: () => [...chatKeys.all, 'archived'] as const,
  detail: (chatId: string) => [...chatKeys.all, chatId] as const,
  messages: (chatId: string) => [...chatKeys.detail(chatId), 'messages'] as const,
  pins: (chatId: string) => [...chatKeys.detail(chatId), 'pins'] as const,
  members: (chatId: string) => [...chatKeys.detail(chatId), 'members'] as const,
};

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  profile: (userId: string) => [...userKeys.all, 'profile', userId] as const,
  settings: () => [...userKeys.all, 'settings'] as const,
  sessions: () => [...userKeys.all, 'sessions'] as const,
  search: (query: string) => [...userKeys.all, 'search', query] as const,
};
