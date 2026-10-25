import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useChatUiStore } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { describeApiError } from '@/shared/api';
import { ROUTES } from '@/shared/config';
import { showToast } from '@/shared/ui';

/**
 * Перейти к исходному сообщению из «Избранного» (#1076).
 *
 * У пересланного известен id оригинала, но не его чат: его спрашиваем у
 * сервера. Переход — тем же запросом, что из общего в профиле (#842):
 * лента чата оригинала догрузится до него и подсветит. Оригинал удалён или
 * доступа к чату больше нет — сервер отвечает одним 404, и человек
 * остаётся в «Избранном» с подсказкой, а не на экране ошибки.
 */
export function useOpenOriginalMessage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chatId: openChatId } = useParams<{ chatId: string }>();
  const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);
  // Повторные нажатия, пока сервер отвечает, ничего не делают.
  const pending = useRef(false);

  return useCallback(
    async (messageId: string) => {
      if (pending.current) return;
      pending.current = true;
      try {
        const chatId = await services.messageService.getMessageLocation(messageId);
        setJumpRequest({ chatId, messageId });
        if (chatId !== openChatId) navigate(ROUTES.CHAT_BY_ID(chatId));
      } catch (error) {
        const { status, code } = (error ?? {}) as { status?: number; code?: string };
        if (status === 404 || code === 'message_not_found') {
          showToast(
            'info',
            t('savedMessages.originalUnavailable', 'Исходное сообщение удалено или недоступно')
          );
        } else {
          showToast(
            'error',
            describeApiError(
              error as { code?: string; message?: string },
              t,
              t('savedMessages.originalFailed', 'Не удалось открыть исходное сообщение')
            )
          );
        }
      } finally {
        pending.current = false;
      }
    },
    [navigate, openChatId, setJumpRequest, t]
  );
}
