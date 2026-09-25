import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { blockedUsersQuery } from '@/entities/user';
import type { IBlockedUserDto } from '@/types';

export function useBlockedUsers() {
  const query = useQuery(blockedUsersQuery());
  const blockedUsers = (query.data ?? []) as IBlockedUserDto[];

  const isUserBlocked = useCallback(
    (userId?: string | null) => {
      if (!userId) return false;
      return blockedUsers.some((u) => u.id === userId);
    },
    [blockedUsers]
  );

  return {
    ...query,
    blockedUsers,
    isUserBlocked,
    blockedCount: blockedUsers.length,
  };
}
