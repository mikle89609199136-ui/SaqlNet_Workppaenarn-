import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatUiStore } from '@/entities/chat';
import { putThreadMessages } from '@/entities/message';
import { services } from '@/services';
import { describeApiError } from '@/shared/api';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
import type { IMessageDto } from '@/types';
import { useForwardStore } from './forwardStore';

/**
 * Пачки пересылки: комментарий занимает место в первой, остальное — по
 * пределу отправки. Выделить больше предела нельзя, так что вторая пачка
 * появляется, только когда к полной пачке пересланных добавлен комментарий.
 */
function forwardBatches(messages: IMessageDto[], hasComment: boolean): IMessageDto[][] {
  const first = MAX_MESSAGES_PER_SEND - (hasComment ? 1 : 0);
  const batches = [messages.slice(0, first)];

  for (let start = first; start < messages.length; start += MAX_MESSAGES_PER_SEND) {
    batches.push(messages.slice(start, start + MAX_MESSAGES_PER_SEND));
  }

  return batches;
}

/**
 * Отправка отложенной пересылки из поля ввода целевого чата (#93).
 *
 * Комментарий и пересланные уходят одной пачкой (#808): комментарий
 * первым, обычным сообщением, за ним пересланные в хронологическом
 * порядке. Пересланное шифруется заново ключом этого чата
 * (`forwardMessages`): переложить шифровку из другого чата нельзя.
 *
 * Пачка пишется целиком или не пишется вовсе, поэтому при сбое всё
 * остаётся в плашке и «Отправить» повторит то же самое. Частично ушедшей
 * пересылка бывает только на границе пачек — если к сотне пересланных
 * добавлен комментарий.
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
      for (const batch of forwardBatches(messages, Boolean(comment))) {
        const delivered = await services.messageService.forwardMessages(
          chatId,
          batch,
          commentSent ? '' : comment
        );
        // Пачкой: одна запись в ленту и один перезапрос списка чатов.
        putThreadMessages(
          queryClient,
          chatId,
          delivered.map((message) => ({ ...message, status: 'sent' as const }))
        );
        commentSent = Boolean(comment);
        sent += batch.length;
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
