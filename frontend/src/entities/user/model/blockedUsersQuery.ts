import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import type { IBlockedUserDto } from './types';

/**
 * Список пользователей, которых заблокировал текущий пользователь.
 */
export function blockedUsersQuery() {
  return queryOptions<IBlockedUserDto[]>({
    queryKey: userKeys.blocked(),
    queryFn: () => services.userService.listBlocked(),
  });
}
