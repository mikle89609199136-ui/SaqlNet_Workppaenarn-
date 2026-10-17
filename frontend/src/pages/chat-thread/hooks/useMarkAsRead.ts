import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { markChatRead } from '@/entities/chat';
import { isUnsent, markThreadRead } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import type { TMessagesList } from '@/types';

export const MARK_READ_BATCH_MS = 300;

export function useMarkAsRead(chatId: string, currentUserId?: string) {
  const queryClient = useQueryClient();
  const requestedRef = useRef(new Set<string>());
  const pendingRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const messageIds = pendingRef.current.splice(0);
    if (messageIds.length === 0) return;

    services.messageService
      .markAsRead(chatId, messageIds)
      .then(({ readIds, lastReadAt }) => {
        markThreadRead(queryClient, chatId, readIds);
        if (lastReadAt) markChatRead(queryClient, chatId, lastReadAt, readIds.length);
      })
      .catch((error) => {
        messageIds.forEach((id) => requestedRef.current.delete(id));
        console.warn('Failed to mark messages as read', error);
      });
  }, [chatId, queryClient]);

  useEffect(() => flush, [flush]);

  return useCallback(
    (messages: TMessagesList) => {
      const fresh = messages
        .filter(
          (message) =>
            message?.id &&
            message.senderId !== currentUserId &&
            // Последняя граница перед сервером: временный id он отклонит
            // вместе со всей пачкой, и входящие не отметятся (#1067).
            !isUnsent(message) &&
            !requestedRef.current.has(message.id)
        )
        .map((message) => message.id);

      if (fresh.length === 0) return;

      fresh.forEach((id) => requestedRef.current.add(id));
      pendingRef.current.push(...fresh);
      timerRef.current ??= setTimeout(flush, MARK_READ_BATCH_MS);
    },
    [currentUserId, flush]
  );
}
