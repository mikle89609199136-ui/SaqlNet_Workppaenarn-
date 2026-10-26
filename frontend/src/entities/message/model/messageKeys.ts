/**
 * Ключи запросов сообщений.
 */
export const messageKeys = {
  all: (chatId: string) => ['chat', chatId, 'messages'] as const,
  pins: (chatId: string) => ['chat', chatId, 'pins'] as const,
  reactionAuthorsPrefix: (messageId: string) =>
    ['message', messageId, 'reactions', 'users'] as const,
  reactionAuthors: (messageId: string, emoji: string) =>
    ['message', messageId, 'reactions', 'users', emoji] as const,
  reactionAuthorsSummary: (messageId: string, emoji: string) =>
    ['message', messageId, 'reactions', 'users', 'summary', emoji] as const,
};
