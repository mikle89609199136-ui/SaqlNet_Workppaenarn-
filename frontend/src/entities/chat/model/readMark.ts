import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { IChatDto } from './types';
import { chatKeys } from './chatKeys';

/** Отметка прочтения чата: до какого момента прочитан и сколько непрочитанных. */
export interface IChatReadMark {
  chatId: string;
  lastReadAt?: string;
  unreadCount: number;
}

const LISTS = [chatKeys.list(), chatKeys.archived()];

const later = (a?: string, b?: string) =>
  !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;

/**
 * Отметка прочтения на момент открытия чата (#839).
 *
 * Список чатов свежее: его перезапрашивают по событиям сервера, а данные
 * самого чата кешируются на минуты. Поэтому счётчик — из списка, если чат
 * там есть, а отметка — более поздняя из двух.
 */
export function useChatReadMark(chat: IChatDto | null): IChatReadMark | undefined {
  const queryClient = useQueryClient();
  return useMemo(() => {
    if (!chat) return undefined;
    const listed = LISTS.flatMap((key) => queryClient.getQueryData<IChatDto[]>(key) ?? []).find(
      (item) => item.id === chat.id
    );
    return {
      chatId: chat.id,
      lastReadAt: later(listed?.lastReadAt, chat.lastReadAt),
      unreadCount: listed?.unreadCount ?? chat.unreadCount ?? 0,
    };
  }, [chat, queryClient]);
}

/**
 * Прочитал — отметка сразу в данные чата и в списки: по ней ставится
 * «Новые сообщения» при следующем открытии, и прочитанное не должно снова
 * оказаться новым, пока кеш не обновился.
 */
export function markChatRead(queryClient: QueryClient, chatId: string, lastReadAt: string) {
  const apply = (chat: IChatDto): IChatDto =>
    chat.id === chatId
      ? { ...chat, lastReadAt: later(chat.lastReadAt, lastReadAt), unreadCount: 0 }
      : chat;
  queryClient.setQueryData<IChatDto>(chatKeys.detail(chatId), (chat) => chat && apply(chat));
  for (const key of LISTS) {
    queryClient.setQueryData<IChatDto[]>(key, (chats) => chats?.map(apply));
  }
}
