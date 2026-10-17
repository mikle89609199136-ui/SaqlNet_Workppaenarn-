import { showToast } from '@/shared/ui';
import { describeApiError } from '@/shared/api';
import { ROUTES } from '@/shared/config';
import { chatKeys } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * Открыть «Избранное» (#1075).
 *
 * Сервер заводит его при первом обращении, поэтому список чатов
 * сбрасывается — как при начале личной переписки. Сам себя в поиске людей
 * человек не находит, так что другого входа нет.
 */
export function useOpenSavedMessages() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const ownUserId = useProfileStore((state) => state.user?.id);

  return useMutation({
    mutationFn: () => {
      if (!ownUserId) throw new Error('Нет профиля');
      return services.chatService.openSavedMessages(ownUserId);
    },
    onSuccess: async (chatId: string) => {
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      navigate(ROUTES.CHAT_BY_ID(chatId));
    },
    onError: (error: Error) => {
      showToast(
        'error',
        describeApiError(error, t, t('savedMessages.openFailed', 'Не удалось открыть Избранное'))
      );
    },
  });
}
