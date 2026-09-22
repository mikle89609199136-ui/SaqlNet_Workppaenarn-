/**
 * Ключи запросов пользователя.
 */
export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  profile: (userId: string) => [...userKeys.all, 'profile', userId] as const,
  settings: () => [...userKeys.all, 'settings'] as const,
  sessions: () => [...userKeys.all, 'sessions'] as const,
  search: (query: string) => [...userKeys.all, 'search', query] as const,
};
