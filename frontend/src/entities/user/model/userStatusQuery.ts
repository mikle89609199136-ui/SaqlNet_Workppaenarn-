import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import type { IUserStatusDto } from './types';

/**
 * Статус присутствия пользователя (онлайн/офлайн и время последней активности).
 *
 * Опрашивается с интервалом 30 секунд при открытом профиле.
 */
export function userStatusQuery(userId: string, options?: { enabled?: boolean }) {
  return queryOptions<IUserStatusDto>({
    queryKey: userKeys.status(userId),
    queryFn: () => services.userService.getStatus(userId),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    enabled: Boolean(userId) && (options?.enabled ?? true),
  });
}
