import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatUiStore } from '@/entities/chat';
import { putThreadMessage } from '@/entities/message';
import { services } from '@/services';
import { describeApiError } from '@/shared/api';
import { useForwardStore } from './forwardStore';

/**
 * Отправка отложенной пересылки из поля ввода целевого чата (#93).
 *
 * Сначала комментарий — обычным сообщением, затем пересланные по одному в
 * хронологическом порядке. Пересланное шифруется заново ключом этого чата
 * (`forwardMessage`): переложить шифровку из другого чата нельзя, поэтому
 * отдельного серверного эндпоинта пересылки здесь нет.
 *
 * Сбой на середине не теряется молча: отправленное остаётся отправленным,
 * неотправленное — в плашке, и «Отправить» повторит только его.
 */
export function useForwardSend(chatId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pending = useForwardStore((state) =>
    state.pending?.targetChatId === chatId ? state.pending : null
  );
  const setError = useChatUiStore((state) => state.setError);
  const [isForwarding, setForwarding] = useState(false);

  /**
   * `done` — всё ушло. `commentSent` — комментарий уже в чате: при сбое
   * пересылки его не возвращают в поле, иначе повтор отправил бы его
   * дважды. Причина сбоя уже показана.
   */
  async function send(comment: string): Promise<{ done: boolean; commentSent: boolean }> {
    if (!pending || isForwarding) return { done: false, commentSent: false };

    setForwarding(true);
    setError('');
    const { messages } = pending;
    let sent = 0;
    let commentSent = false;

    try {
      if (comment) {
        const message = await services.messageService.sendMessage(chatId, comment);
        putThreadMessage(queryClient, chatId, { ...message, status: 'sent' });
        commentSent = true;
      }

      for (const original of messages) {
        const message = await services.messageService.forwardMessage(original, chatId);
        putThreadMessage(queryClient, chatId, { ...message, status: 'sent' });
        sent += 1;
      }

      useForwardStore.getState().cancel();
      return { done: true, commentSent };
    } catch (error) {
      useForwardStore.getState().keep(messages.slice(sent));
      const reason = describeApiError(
        error as { code?: string; message?: string },
        t,
        t('messageSendError', 'Не удалось отправить сообщение')
      );
      setError(
        sent > 0
          ? t('forward.partial', {
              defaultValue:
                'Переслано {{sent}} из {{total}}. Остальные остались над полем ввода — нажмите «Отправить», чтобы повторить. {{reason}}',
              sent,
              total: messages.length,
              reason,
            })
          : reason
      );
      return { done: false, commentSent };
    } finally {
      setForwarding(false);
    }
  }

  return {
    pending,
    isForwarding,
    send,
    cancel: () => useForwardStore.getState().cancel(),
  };
}
