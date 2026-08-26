import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from '../keys';

/**
 * Профиль другого пользователя.
 *
 * Раньше его запрашивал обработчик клика по шапке чата и складывал ответ
 * в состояние компонента: закрыть и открыть панель означало сходить на
 * сервер заново (#232). Имя и аватар меняются редко, поэтому запрос
 * считается свежим пять минут.
 */
export function userProfileQuery(userId: string) {
  return queryOptions({
    queryKey: userKeys.profile(userId),
    queryFn: () => services.userService.getProfile(userId),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(userId),
  });
}
