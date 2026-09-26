import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import type { ICheckUsernameResponse } from './types';

export const MIN_USERNAME_LENGTH = 3;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Проверка доступности имени пользователя.
 */
export function checkUsernameQuery(username: string) {
  const normalized = username.trim();

  return queryOptions<ICheckUsernameResponse>({
    queryKey: userKeys.checkUsername(normalized),
    queryFn: () => services.userService.checkUsername(normalized),
    staleTime: 30 * 1000,
    enabled: normalized.length >= MIN_USERNAME_LENGTH && USERNAME_PATTERN.test(normalized),
  });
}
