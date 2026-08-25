import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WS_EVENTS } from '@/consts';
import { chatKeys } from '@/queries/keys';
import {
  appendMessage,
  canAppendToThread,
  patchMessage,
  removeMessage,
  type IThreadPages,
} from '@/queries/chat/threadCache';
import { services } from '@/services/serviceContainer';
import type { IMessageDto, IPinnedDto, ITypingEvent } from '@/types';
import { useRealtimeSocket } from '@/hooks/useRealtimeSocket';

/** Сколько показывать «печатает», если следующего события так и не пришло. */
const TYPING_TIMEOUT_MS = 3000;

interface IUseThreadRealtimeOptions {
  chatId: string;
  currentUserId?: string;
  onIncomingMessage: (message: IMessageDto) => void;
}

/**
 * Обновление открытого чата по событиям сервера.
 *
 * Все обработчики пишут в кеш запросов — единственное место, где живёт
 * история. Раньше то же самое приходилось делать дважды: в сторе и во
 * внутреннем кеше сервиса, и там, где об этом забывали, данные расходились.
 */
export function useThreadRealtime({
  chatId,
  currentUserId,
  onIncomingMessage,
}: IUseThreadRealtimeOptions) {
  const queryClient = useQueryClient();
  const { eventBus } = useRealtimeSocket(Boolean(chatId));
  const [typingUserId, setTypingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return undefined;

    let typingTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribeNew = eventBus.on(WS_EVENTS.MESSAGE.NEW, async (event) => {
      if (event.chatId !== chatId || !event.message) return;

      const message = await services.messageService.processMessageForDisplay(chatId, event.message);

      const current = queryClient.getQueryData<IThreadPages>(chatKeys.messages(chatId));

      // Историю, которую ещё не загружали, нельзя дополнять по одному
      // сообщению: она будет принята за полную, и чат откроется пустым (#174).
      if (!canAppendToThread(current)) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
      } else {
        queryClient.setQueryData(chatKeys.messages(chatId), appendMessage(current, message));
      }

      onIncomingMessage(message);
    });

    const unsubscribeEdited = eventBus.on(WS_EVENTS.MESSAGE.EDITED, (event) => {
      // Событие приходит по всем чатам сразу: без проверки правка из соседнего
      // чата применялась бы к открытому.
      if (event.chatId && event.chatId !== chatId) return;

      queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
        current
          ? patchMessage(current, event.messageId, {
              content: event.content,
              isEdited: true,
              updatedAt: event.updatedAt,
            })
          : current
      );
      void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
    });

    const unsubscribeDeleted = eventBus.on(WS_EVENTS.MESSAGE.DELETED, (event) => {
      if (event.chatId && event.chatId !== chatId) return;

      queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
        current ? removeMessage(current, event.messageId) : current
      );
      // Удалённое сообщение могло быть закреплено — панель обязана обновиться.
      void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
    });

    const unsubscribeReaction = eventBus.on(WS_EVENTS.REACTIONS.REACTION_UPDATED, (event) => {
      if (event.chatId && event.chatId !== chatId) return;

      queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
        current ? patchMessage(current, event.messageId, { reactions: event.reactions }) : current
      );
    });

    const unsubscribePinned = eventBus.on(WS_EVENTS.MESSAGE.PINNED, async (event) => {
      if (event.chatId && event.chatId !== chatId) return;

      const message = await services.messageService.processMessageForDisplay(
        chatId,
        event.pin.message
      );
      const pinned: IPinnedDto = { ...event.pin, message };

      queryClient.setQueryData<IPinnedDto[]>(chatKeys.pins(chatId), (current) =>
        current ? [...current, pinned] : [pinned]
      );
    });

    const unsubscribeUnpinned = eventBus.on(WS_EVENTS.MESSAGE.UNPINNED, (event) => {
      if (event.chatId && event.chatId !== chatId) return;

      queryClient.setQueryData<IPinnedDto[]>(chatKeys.pins(chatId), (current) =>
        current ? current.filter((item) => item.messageId !== event.messageId) : current
      );
    });

    const unsubscribeTyping = eventBus.on(WS_EVENTS.USER.TYPING, (event: ITypingEvent) => {
      if (event.chatId !== chatId) return;

      const userId = event.userId || event.senderId;
      if (!userId || userId === currentUserId) return;

      setTypingUserId(userId);
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTypingUserId(null), TYPING_TIMEOUT_MS);
    });

    return () => {
      unsubscribeNew();
      unsubscribeEdited();
      unsubscribeDeleted();
      unsubscribeReaction();
      unsubscribePinned();
      unsubscribeUnpinned();
      unsubscribeTyping();
      if (typingTimer) clearTimeout(typingTimer);
    };
  }, [chatId, currentUserId, eventBus, onIncomingMessage, queryClient]);

  return { typingUserId };
}
