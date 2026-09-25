import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '@/shared/api';
import { showToast } from '@/shared/ui';
import { userKeys } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import type { IBlockedUserDto } from '@/types';

export interface IBlockUserParams {
  userId: string;
  user?: Partial<IBlockedUserDto>;
}

export function useBlockUserMutation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId }: IBlockUserParams) => {
      await services.userService.blockUser(userId);
      return { userId };
    },
    onSuccess: ({ userId }, variables) => {
      queryClient.setQueryData<IBlockedUserDto[]>(userKeys.blocked(), (old = []) => {
        if (old.some((u) => u.id === userId)) return old;
        const entry: IBlockedUserDto = {
          id: userId,
          username: variables.user?.username ?? '',
          firstName: variables.user?.firstName ?? '',
          lastName: variables.user?.lastName ?? '',
          avatarUrl: variables.user?.avatarUrl ?? '',
          blockedAt: new Date().toISOString(),
        };
        return [entry, ...old];
      });
      void queryClient.invalidateQueries({ queryKey: userKeys.blocked() });
      showToast('success', t('toast.userBlocked', 'Пользователь заблокирован'));
    },
    onError: (err) => {
      showToast(
        'error',
        describeApiError(
          err as { code?: string; message?: string },
          t,
          t('toast.blockFailed', 'Не удалось заблокировать пользователя')
        )
      );
    },
  });
}
