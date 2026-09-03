import { ROUTES } from '@/consts';
import { chatKeys } from '@/queries/keys';
import { services } from '@/services/serviceContainer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useToasts } from './useToasts';

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
  const { showToast } = useToasts();
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
      showToast('error', error.message || t('chatCreateFailed', 'Не удалось открыть чат'));
    },
  });
}
