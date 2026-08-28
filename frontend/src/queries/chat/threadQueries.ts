import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { chatKeys } from '../keys';

/** Размер страницы истории — тот же, что запрашивала страница чата до миграции. */
export const MESSAGES_PAGE_SIZE = 50;

export function chatQuery(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.detail(chatId),
    queryFn: () => services.chatService.getChat(chatId),
    // Название и участники меняются редко, а об изменениях приходит событие.
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(chatId),
  });
}

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
