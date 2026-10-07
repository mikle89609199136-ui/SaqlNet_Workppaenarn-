import type { QueryClient } from '@tanstack/react-query';
import { isCoveredBy, receiptPatch, type IReceiptEvent } from '@/shared/lib';
import { chatKeys } from './chatKeys';
import type { IChatDto } from './types';

/**
 * Галочки последнего сообщения в списке чатов по событию `receipts`
 * (#657) — на месте, без перезапроса списка.
 *
 * Время последнего сообщения — `lastMessageAt` чата. Сообщение собеседника,
 * чья граница сдвинулась, не трогается: галочки только у своего.
 */
export function applyChatListReceipt(chats: IChatDto[], event: IReceiptEvent): IChatDto[] {
  let changed = false;
  const next = chats.map((chat) => {
    const last = chat.lastMessage;
    if (chat.id !== event.chatId || !last || last.senderId === event.userId) return chat;
    if (!isCoveredBy(chat.lastMessageAt, event.upTo)) return chat;
    const patch = receiptPatch(last, event.kind, event.at);
    if (!patch) return chat;
    changed = true;
    return { ...chat, lastMessage: { ...last, ...patch } };
  });
  return changed ? next : chats;
}

export function putChatListReceipt(queryClient: QueryClient, event: IReceiptEvent): void {
  for (const queryKey of [chatKeys.list(), chatKeys.archived()]) {
    queryClient.setQueryData<IChatDto[]>(queryKey, (chats) =>
      chats ? applyChatListReceipt(chats, event) : chats
    );
  }
}
