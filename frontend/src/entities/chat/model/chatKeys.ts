/**
 * Ключи запросов чатов.
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
  /** Общее в переписке по виду — вкладки профиля (#842). */
  shared: (chatId: string, kind: string) => [...chatKeys.detail(chatId), 'shared', kind] as const,
  pins: (chatId: string) => [...chatKeys.detail(chatId), 'pins'] as const,
  members: (chatId: string) => [...chatKeys.detail(chatId), 'members'] as const,
  membersOnline: (chatId: string) => [...chatKeys.detail(chatId), 'members-online'] as const,
};
