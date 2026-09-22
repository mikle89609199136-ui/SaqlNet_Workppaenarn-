import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { chatKeys } from '@/entities/chat';
import { flattenThread } from './threadCache';
import { getChatOutbox } from './outboxStore';
import { sortMessagesChronologically } from '@/shared/lib';
import type { IMessageDto, TMediaMessageType } from './types';

/** Размер страницы истории — тот же, что запрашивала страница чата до миграции. */
export const MESSAGES_PAGE_SIZE = 50;

export function messagesQuery(chatId: string) {
  return infiniteQueryOptions({
    queryKey: chatKeys.messages(chatId),
    // Расшифровка выполняется здесь, а не в select: select синхронен
    // и вызывается на каждом рендере — расшифровывать в нём невозможно.
    queryFn: ({ pageParam }) =>
      services.messageService.fetchMessagesPage(chatId, pageParam, MESSAGES_PAGE_SIZE),
    initialPageParam: 0,
    // Неполная страница означает, что история кончилась.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < MESSAGES_PAGE_SIZE ? undefined : allPages.length * MESSAGES_PAGE_SIZE,
    // Страницы склеиваются в одну ленту здесь, а не у каждого читателя.
    // Результат `select` кешируется до следующего изменения данных, тогда
    // как склейка в теле хука давала бы новый массив на каждый рендер —
    // а лента служит зависимостью эффектов, и новая ссылка на ней
    // запускает их заново.
    select: (data) => {
      const thread = flattenThread(data);
      const outbox = getChatOutbox(chatId);
      if (!outbox.length) return thread;

      const existingIds = new Set(thread.map((m) => m.id));
      const outboxMessages: IMessageDto[] = [];
      for (const item of outbox) {
        if (!existingIds.has(item.tempId)) {
          outboxMessages.push({
            id: item.tempId,
            tempId: item.tempId,
            chatId: item.chatId,
            content: item.content,
            type: item.type,
            mediaType: item.type !== 'text' ? (item.type as TMediaMessageType) : undefined,
            mediaUrl: item.blobUrl,
            replyTo: item.replyToId ?? null,
            replyToMessageId: item.replyToId ?? null,
            senderId: '',
            senderFirstName: '',
            senderName: '',
            forwardedSenderName: '',
            replySenderName: null,
            replyToSenderName: null,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
            isEdited: false,
            isForwarded: false,
            isPinned: false,
            reactions: [],
            status: item.status,
          });
        }
      }
      if (!outboxMessages.length) return thread;
      return sortMessagesChronologically<IMessageDto>([...thread, ...outboxMessages]);
    },
    // Свежесть приносит WebSocket, а не повторный опрос: перезапрос истории
    // сбрасывал бы позицию прокрутки и заново расшифровывал бы всю ленту.
    staleTime: Infinity,
    enabled: Boolean(chatId),
  });
}

export function pinsQuery(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.pins(chatId),
    queryFn: () => services.messageService.listPins(chatId),
    staleTime: 60 * 1000,
    enabled: Boolean(chatId),
  });
}
