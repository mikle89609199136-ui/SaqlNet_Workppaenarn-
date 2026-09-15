import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { markThreadRead } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import type { TMessagesList } from '@/types';

/**
 * Отметка чужих сообщений прочитанными.
 *
 * Отмечаются только чужие: собственные сообщения прочитанными не помечают.
 * Подтверждённые сервером идентификаторы проставляются в кеше — раньше это
 * делалось в сторе, и первое сообщение чата не помечалось никогда из-за
 * проверки индекса на ложность.
 */
export function useMarkAsRead(chatId: string, currentUserId?: string) {
  const queryClient = useQueryClient();

  return useCallback(
    (messages: TMessagesList) => {
      const messageIds = messages
        .filter((message) => message?.id && message.senderId !== currentUserId)
        .map((message) => message.id);

      if (messageIds.length === 0) return;

      services.messageService
        .markAsRead(chatId, messageIds)
        .then(({ readIds }) => markThreadRead(queryClient, chatId, readIds))
        .catch((error) => {
          // Непрочитанная отметка не стоит того, чтобы ронять открытый чат.
          console.warn('Failed to mark messages as read', error);
        });
    },
    [chatId, currentUserId, queryClient]
  );
}
