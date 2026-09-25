import { showToast } from '@/shared/ui';
import { describeApiError } from '@/shared/api';
import { ROUTES } from '@/shared/config';
import { chatKeys } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * Открыть переписку с человеком, которого нашли поиском.
 *
 * Сервер сам возвращает существующий чат, если он уже был, поэтому
 * отдельной проверки здесь нет. Список чатов сбрасывается: без этого
 * новая переписка появлялась в нём только после перезагрузки.
 */
export function useStartPrivateChat() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (userId: string) => services.chatService.createChat('private', [userId]),
    onSuccess: async (data: { chatId?: string }) => {
      if (!data?.chatId) {
        showToast('error', t('chatCreateFailed', 'Не удалось открыть чат'));
        return;
      }

      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      navigate(ROUTES.CHAT_BY_ID(data.chatId));
    },
    onError: (error: Error) => {
      showToast(
        'error',
        describeApiError(error, t, t('chatCreateFailed', 'Не удалось открыть чат'))
      );
    },
  });
}
