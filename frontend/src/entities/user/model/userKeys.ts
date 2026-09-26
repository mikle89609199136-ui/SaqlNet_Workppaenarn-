/**
 * Ключи запросов пользователя.
 */
export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  profile: (userId: string) => [...userKeys.all, 'profile', userId] as const,
  status: (userId: string) => [...userKeys.all, 'status', userId] as const,
  checkUsername: (username: string) => [...userKeys.all, 'check-username', username] as const,
  settings: () => [...userKeys.all, 'settings'] as const,
  sessions: () => [...userKeys.all, 'sessions'] as const,
  search: (query: string) => [...userKeys.all, 'search', query] as const,
  /** Чёрный список (#727). */
  blocked: () => [...userKeys.all, 'blocked'] as const,
  /** Исключения из правил приватности, все правила сразу (#786). */
  privacyExceptions: () => [...userKeys.all, 'privacyExceptions'] as const,
};
