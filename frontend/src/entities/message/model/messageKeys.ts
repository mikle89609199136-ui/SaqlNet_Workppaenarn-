/**
 * Ключи запросов сообщений.
 */
export const messageKeys = {
  all: (chatId: string) => ['chat', chatId, 'messages'] as const,
  pins: (chatId: string) => ['chat', chatId, 'pins'] as const,
};
