import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import type { ICheckUsernameResponse } from './types';

export const MIN_USERNAME_LENGTH = 3;

/**
 * Проверка доступности имени пользователя.
 *
 * Если сервер вернул 401 (например, неавторизованный пользователь в мастере
 * регистрации, так как эндпоинт в backend-v2 пока требует bearer-токен),
 * возвращаем null, чтобы UI не ломал процесс и не выдавал ложную ошибку.
 */
export function checkUsernameQuery(username: string) {
  const normalized = username.trim().replace(/^@/, '');

  return queryOptions<ICheckUsernameResponse | null>({
    queryKey: userKeys.checkUsername(normalized),
    queryFn: async () => {
      try {
        return await services.userService.checkUsername(normalized);
      } catch (error: unknown) {
        const err = error as { status?: number; data?: { code?: string }; message?: string };
        if (
          err?.status === 401 ||
          err?.data?.code === 'missing_token' ||
          err?.message?.includes('401')
        ) {
          return null;
        }
        throw error;
      }
    },
    staleTime: 30 * 1000,
    enabled: normalized.length >= MIN_USERNAME_LENGTH,
  });
}
