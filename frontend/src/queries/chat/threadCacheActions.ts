import type { QueryClient } from '@tanstack/react-query';
import type { IMessageDto, IPinnedDto } from '@/types';
import { chatKeys } from '../keys';
import {
  appendMessage,
  canAppendToThread,
  patchMessage,
  removeMessage,
  type IThreadPages,
} from './threadCache';

/**
 * Запись в кеш треда.
 *
 * Отдельный слой поверх чистых хелперов: и отправка, и события сервера
 * обновляют одни и те же данные, и правило «когда дописывать, а когда
 * перезапрашивать» должно быть одно на всех.
 */

export function putThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  message: IMessageDto
): void {
  const current = queryClient.getQueryData<IThreadPages>(chatKeys.messages(chatId));

  // Историю, которую ещё не загружали, дополнять нельзя: одно сообщение
  // будет принято за весь чат, и он откроется почти пустым (#174).
  if (!canAppendToThread(current)) {
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    return;
  }

  queryClient.setQueryData(chatKeys.messages(chatId), appendMessage(current, message));
}

export function patchThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  patch: Partial<Omit<IMessageDto, 'id'>>
): void {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
    current ? patchMessage(current, messageId, patch) : current
  );
}

export function dropThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string
): void {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
    current ? removeMessage(current, messageId) : current
  );
  // Удалённое сообщение могло быть закреплено — панель обязана это заметить.
  void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
}

export function putPinnedMessage(
  queryClient: QueryClient,
  chatId: string,
  pinned: IPinnedDto
): void {
  queryClient.setQueryData<IPinnedDto[]>(chatKeys.pins(chatId), (current) =>
    current ? [...current.filter((item) => item.id !== pinned.id), pinned] : [pinned]
  );
}

export function dropPinnedMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string
): void {
  queryClient.setQueryData<IPinnedDto[]>(chatKeys.pins(chatId), (current) =>
    current ? current.filter((item) => item.messageId !== messageId) : current
  );
}

/** Полный сброс данных чата — например, когда сменились ключи шифрования. */
export function invalidateChat(queryClient: QueryClient, chatId: string): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
}
