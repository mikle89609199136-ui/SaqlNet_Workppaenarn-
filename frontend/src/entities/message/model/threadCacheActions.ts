import type { QueryClient } from '@tanstack/react-query';
import type { IMessageDto, IPinnedDto } from './types';
import { chatKeys } from '@/entities/chat';
import type { IReceiptEvent } from '@/shared/lib';
import {
  appendMessage,
  applyReceipt,
  canAppendToThread,
  patchMessage,
  removeMessage,
  replaceMessage,
  type IThreadPages,
} from './threadCache';

/**
 * Запись в кеш треда.
 *
 * Отдельный слой поверх чистых хелперов: и отправка, и события сервера
 * обновляют одни и те же данные, и правило «когда дописывать, а когда
 * перезапрашивать» должно быть одно на всех.
 */

/**
 * Список чатов показывает последнее сообщение каждого чата, поэтому любое
 * изменение ленты делает превью устаревшим.
 *
 * Инвалидируется именно список, а не чат: ключ чата — префикс ключа его
 * истории, и перезапрос по нему стёр бы только что дописанное сообщение.
 *
 * Правило живёт здесь, а не в вызывающем коде: раньше связь ленты и
 * превью поддерживал отдельный хук со своими подписками, и стоило
 * появиться новому способу отправки, как превью переставало обновляться.
 *
 * Уже идущий перезапрос не прерывается (`cancelRefetch: false`): пачка
 * сообщений — своя отправка или N событий `new_message` подряд — иначе
 * давала N запросов списка, каждый из которых отменял предыдущий (#808).
 * Сервер рассылает события после записи всей пачки, так что первый же
 * запрос видит её целиком.
 */
function markChatListStale(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() }, { cancelRefetch: false });
}

export function putThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  message: IMessageDto
): void {
  putThreadMessages(queryClient, chatId, [message]);
}

/**
 * Несколько сообщений разом — ответ на отправку пачкой (#808): одна запись
 * в кеш и одна пометка списка чатов на всю пачку.
 */
export function putThreadMessages(
  queryClient: QueryClient,
  chatId: string,
  messages: IMessageDto[]
): void {
  if (messages.length === 0) return;

  const current = queryClient.getQueryData<IThreadPages>(chatKeys.messages(chatId));

  // Историю, которую ещё не загружали, дополнять нельзя: одно сообщение
  // будет принято за весь чат, и он откроется почти пустым (#174).
  if (!canAppendToThread(current)) {
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    markChatListStale(queryClient);
    return;
  }

  queryClient.setQueryData(
    chatKeys.messages(chatId),
    messages.reduce((pages, message) => appendMessage(pages, message), current)
  );
  markChatListStale(queryClient);
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
  // Отредактированным могло оказаться последнее сообщение чата.
  markChatListStale(queryClient);
}

/**
 * Событие `receipts` (#657): галочки своих сообщений в ленте — на месте.
 * Список чатов обновляется отдельно и тоже без перезапроса.
 */
export function putThreadReceipt(queryClient: QueryClient, event: IReceiptEvent): void {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(event.chatId), (current) =>
    current ? applyReceipt(current, event) : current
  );
}

export function replaceThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  targetId: string,
  replacement: IMessageDto
): void {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
    current ? replaceMessage(current, targetId, replacement) : current
  );
  markChatListStale(queryClient);
}

/**
 * Отметка сообщений прочитанными.
 *
 * Кроме самой ленты обновляется список чатов: счётчик непрочитанных живёт
 * там, и без этого бейдж висел до перезагрузки страницы. Раньше связь
 * поддерживал отдельный хук со своими подписками, вместе с которым она и
 * потерялась.
 *
 * Идентификаторы приходят подтверждённые сервером — отмечается ровно то,
 * что он принял.
 */
export function markThreadRead(
  queryClient: QueryClient,
  chatId: string,
  messageIds: string[]
): void {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
    current
      ? messageIds.reduce(
          (thread, messageId) => patchMessage(thread, messageId, { isRead: true, status: 'read' }),
          current
        )
      : current
  );

  markChatListStale(queryClient);
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
  // ...и быть последним в чате: тогда в списке показывается предыдущее.
  markChatListStale(queryClient);
}

/** То же для пачки (#840): одна перерисовка ленты и одно обновление списка. */
export function dropThreadMessages(
  queryClient: QueryClient,
  chatId: string,
  messageIds: string[]
): void {
  if (messageIds.length === 0) return;
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
    current ? messageIds.reduce((thread, id) => removeMessage(thread, id), current) : current
  );
  void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
  markChatListStale(queryClient);
}

export function putPinnedMessage(
  queryClient: QueryClient,
  chatId: string,
  pinned: IPinnedDto
): void {
  queryClient.setQueryData<IPinnedDto[]>(chatKeys.pins(chatId), (current) =>
    current ? [...current.filter((item) => item.id !== pinned.id), pinned] : [pinned]
  );
  patchThreadMessage(queryClient, chatId, pinned.messageId, { isPinned: true });
}

export function dropPinnedMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string
): void {
  queryClient.setQueryData<IPinnedDto[]>(chatKeys.pins(chatId), (current) =>
    current ? current.filter((item) => item.messageId !== messageId) : current
  );
  patchThreadMessage(queryClient, chatId, messageId, { isPinned: false });
}

/** Полный сброс данных чата — например, когда сменились ключи шифрования. */
export function invalidateChat(queryClient: QueryClient, chatId: string): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
}
