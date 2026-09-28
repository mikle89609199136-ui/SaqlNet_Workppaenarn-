import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import type { IBlockedUserDto } from './types';
import { userKeys } from './userKeys';

/**
 * Чёрный список (#727). По нему же профиль решает, показать
 * «Заблокировать» или «Разблокировать»: отдельного признака в профиле
 * сервер не отдаёт.
 */
export function blockedUsersQuery() {
  return queryOptions({
    queryKey: userKeys.blocked(),
    queryFn: async (): Promise<IBlockedUserDto[]> =>
      (await services.userService.listBlocked()) ?? [],
  });
}
