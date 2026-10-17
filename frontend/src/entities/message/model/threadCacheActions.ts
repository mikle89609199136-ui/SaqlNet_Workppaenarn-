import type { QueryClient } from '@tanstack/react-query';
import type { IReactionUpdatedEvent } from '@/types';
import type { IMessageDto, IPinnedDto } from './types';
import { mergeReactionEvent } from './reactionEvent';
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

type TThreadMutation = (thread: IThreadPages) => IThreadPages;

// Журнал живёт только во время загрузки snapshot. Записываем операции,
// а не разницу значений: снятая реакция может совпасть с исходным состоянием.
const threadChanges = new WeakMap<QueryClient, Map<string, Set<TThreadMutation[]>>>();

export function captureThreadChanges(queryClient: QueryClient, chatId: string) {
  let chats = threadChanges.get(queryClient);
  if (!chats) {
    chats = new Map();
    threadChanges.set(queryClient, chats);
  }
  let listeners = chats.get(chatId);
  if (!listeners) {
    listeners = new Set();
    chats.set(chatId, listeners);
  }
  const changes: TThreadMutation[] = [];
  listeners.add(changes);
  let stopped = false;

  return {
    replay: (thread: IThreadPages): IThreadPages =>
      changes.reduce((current, apply) => apply(current), thread),
    stop: () => {
      if (stopped) return;
      stopped = true;
      listeners.delete(changes);
      if (listeners.size === 0) chats.delete(chatId);
      if (chats.size === 0) threadChanges.delete(queryClient);
    },
  };
}

function hasNewerEdit(
  cached: IMessageDto | undefined,
  incoming: Pick<Partial<IMessageDto>, 'updatedAt'>
): boolean {
  return Boolean(
    cached?.updatedAt &&
    incoming.updatedAt &&
    new Date(cached.updatedAt).getTime() > new Date(incoming.updatedAt).getTime()
  );
}

function mutateThread(queryClient: QueryClient, chatId: string, apply: TThreadMutation): void {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (current) =>
    current ? apply(current) : current
  );
  for (const changes of threadChanges.get(queryClient)?.get(chatId) ?? []) changes.push(apply);
}

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
 * При синхронизации истории replaceExisting обновляет и известные ID:
 * за время обрыва их могли отредактировать или восстановить ключи.
 */
export function putThreadMessages(
  queryClient: QueryClient,
  chatId: string,
  messages: IMessageDto[],
  {
    replaceExisting = false,
    replay,
  }: {
    replaceExisting?: boolean;
    replay?: TThreadMutation;
  } = {}
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

  const merge: TThreadMutation = (thread) =>
    messages.reduce((pages, message) => {
      if (!replaceExisting) return appendMessage(pages, message);

      // Пока HTTP-страница загружалась, realtime мог принести более
      // свежую правку. Равные версии заменяем: ключ мог стать доступен.
      const cached = pages.pages.flat().find((item) => item.id === message.id);
      if (hasNewerEdit(cached, message)) {
        return pages;
      }
      return replaceMessage(pages, message.id, message);
    }, thread);
  if (replaceExisting) {
    // Snapshot уже включает старые операции. В журнал попадают только
    // изменения из realtime/действий пользователя, а не другой snapshot.
    queryClient.setQueryData<IThreadPages>(chatKeys.messages(chatId), (thread) => {
      if (!thread) return thread;
      const merged = merge(thread);
      return replay ? replay(merged) : merged;
    });
  } else {
    mutateThread(queryClient, chatId, merge);
  }
  markChatListStale(queryClient);
}

/**
 * Реакции из события `reaction_updated` (#1063).
 *
 * Отметка «моя» считается внутри мутации — по сообщению, которое лежит в
 * ленте в момент применения. Так операция верно переигрывается журналом
 * поверх снимка истории, который ещё грузится.
 */
export function applyThreadReactionEvent(
  queryClient: QueryClient,
  event: Pick<IReactionUpdatedEvent, 'chatId' | 'messageId' | 'actorId' | 'change' | 'reactions'>,
  currentUserId: string | undefined
): void {
  mutateThread(queryClient, event.chatId, (current) => {
    const cached = current.pages.flat().find((item) => item.id === event.messageId);
    if (!cached) return current;
    return patchMessage(current, event.messageId, {
      reactions: mergeReactionEvent(cached.reactions, event, currentUserId),
    });
  });
  markChatListStale(queryClient);
}

export function patchThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  patch: Partial<Omit<IMessageDto, 'id'>>
): void {
  mutateThread(queryClient, chatId, (current) => {
    const cached = current.pages.flat().find((item) => item.id === messageId);
    if (hasNewerEdit(cached, patch)) return current;
    return patchMessage(current, messageId, patch);
  });
  // Отредактированным могло оказаться последнее сообщение чата.
  markChatListStale(queryClient);
}

/**
 * Событие `receipts` (#657): галочки своих сообщений в ленте — на месте.
 * Список чатов обновляется отдельно и тоже без перезапроса.
 */
export function putThreadReceipt(queryClient: QueryClient, event: IReceiptEvent): void {
  mutateThread(queryClient, event.chatId, (current) => applyReceipt(current, event));
}

export function replaceThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  targetId: string,
  replacement: IMessageDto
): void {
  mutateThread(queryClient, chatId, (current) => replaceMessage(current, targetId, replacement));
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
  mutateThread(queryClient, chatId, (current) =>
    messageIds.reduce(
      (thread, messageId) => patchMessage(thread, messageId, { isRead: true, status: 'read' }),
      current
    )
  );

  markChatListStale(queryClient);
}

export function dropThreadMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string
): void {
  mutateThread(queryClient, chatId, (current) => removeMessage(current, messageId));
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
  mutateThread(queryClient, chatId, (current) =>
    messageIds.reduce((thread, id) => removeMessage(thread, id), current)
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
