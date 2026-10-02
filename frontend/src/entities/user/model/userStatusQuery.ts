import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import type { IUserStatusDto } from './types';

/**
 * Статус присутствия пользователя (онлайн/офлайн и время последней активности).
 *
 * Опрашивается с интервалом 30 секунд при открытом профиле.
 */
interface IStatusQueryError {
  status?: number;
}

export function userStatusQuery(userId: string, options?: { enabled?: boolean }) {
  return queryOptions<IUserStatusDto, IStatusQueryError>({
    queryKey: userKeys.status(userId),
    queryFn: () => services.userService.getStatus(userId),
    staleTime: 30 * 1000,
    refetchInterval: (query) => (query.state.error?.status === 404 ? false : 30 * 1000),
    retry: (failureCount, error) => (error?.status === 404 ? false : failureCount < 3),
    enabled: Boolean(userId) && (options?.enabled ?? true),
  });
}
