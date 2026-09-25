import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '@/shared/api';
import { showToast } from '@/shared/ui';
import { userKeys } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import type { IBlockedUserDto } from '@/types';

export function useUnblockUserMutation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      await services.userService.unblockUser(userId);
      return userId;
    },
    onSuccess: (userId) => {
      queryClient.setQueryData<IBlockedUserDto[]>(userKeys.blocked(), (old = []) =>
        old.filter((u) => u.id !== userId)
      );
      void queryClient.invalidateQueries({ queryKey: userKeys.blocked() });
      showToast('success', t('toast.userUnblocked', 'Пользователь разблокирован'));
    },
    onError: (err) => {
      showToast(
        'error',
        describeApiError(
          err as { code?: string; message?: string },
          t,
          t('toast.unblockFailed', 'Не удалось разблокировать пользователя')
        )
      );
    },
  });
}
