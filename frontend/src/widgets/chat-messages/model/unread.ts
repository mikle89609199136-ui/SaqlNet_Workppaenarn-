import type { IMessageDto, TMessagesList } from '@/types';

/**
 * «Новые сообщения» при открытии чата (#839).
 *
 * Непрочитанные — чужие сообщения новее отметки прочтения чата: так же их
 * считает сервер (`unreadCount`). У самих сообщений признака прочтения нет —
 * сервер его не присылает, клиент ставит только после своей отметки.
 */

/** Сколько страниц истории догружать при открытии до первого непрочитанного. */
export const MAX_UNREAD_PAGES = 20;

/** Отметка прочтения открытого чата — от страницы, из данных чата. */
export interface IReadMark {
  chatId: string;
  /** Пусто — чат ещё не читали: непрочитанное всё чужое. */
  lastReadAt?: string | null;
  /** Сколько чужих непрочитанных насчитал сервер — столько и ищем. */
  unreadCount: number;
}

/**
 * Что было непрочитанным, когда чат открыли. Снимается один раз на чат:
 * сразу после загрузки лента отмечается прочитанной, и отметка чата
 * уходит вперёд — без снимка разделитель исчез бы в ту же секунду.
 */
export interface IUnreadSnapshot {
  chatId: string;
  lastReadMs: number;
  unreadCount: number;
  /** Самое новое сообщение на момент открытия: пришедшее позже — новое. */
  newestAtOpenMs: number;
  /** Сколько страниц догружено при открытии. */
  pagesLoaded: number;
  /** Догрузка до первого непрочитанного закончена: можно прокручивать. */
  settled: boolean;
}

export function timeMs(value: IMessageDto['createdAt'] | string | null | undefined): number {
  if (!value) return Number.NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

const isIncoming = (message: IMessageDto, currentUserId?: string) =>
  message.senderId !== currentUserId;

const isUnreadAtOpen = (
  message: IMessageDto,
  snapshot: Pick<IUnreadSnapshot, 'lastReadMs' | 'newestAtOpenMs'>,
  currentUserId?: string
) => {
  if (!isIncoming(message, currentUserId)) return false;
  const at = timeMs(message.createdAt);
  return at > snapshot.lastReadMs && at <= snapshot.newestAtOpenMs;
};

/** Загружено меньше непрочитанных, чем насчитал сервер, — остальные выше. */
export function hasUnreadAbove(
  messages: TMessagesList,
  snapshot: IUnreadSnapshot,
  currentUserId: string | undefined,
  hasOlder: boolean
): boolean {
  if (!hasOlder || snapshot.unreadCount === 0) return false;
  // Загружено уже прочитанное — выше непрочитанных нет, даже если счётчик устарел.
  if (messages.length > 0 && timeMs(messages[0].createdAt) <= snapshot.lastReadMs) return false;
  const loaded = messages.filter((message) => isUnreadAtOpen(message, snapshot, currentUserId));
  return loaded.length < snapshot.unreadCount;
}

export function needsOlderForUnread(
  messages: TMessagesList,
  snapshot: IUnreadSnapshot,
  currentUserId: string | undefined,
  hasOlder: boolean
): boolean {
  return (
    snapshot.pagesLoaded < MAX_UNREAD_PAGES &&
    hasUnreadAbove(messages, snapshot, currentUserId, hasOlder)
  );
}

export function takeUnreadSnapshot(
  messages: TMessagesList,
  readMark: IReadMark,
  currentUserId: string | undefined,
  hasOlder: boolean,
  canLoadOlder: boolean
): IUnreadSnapshot {
  const read = timeMs(readMark.lastReadAt);
  const snapshot: IUnreadSnapshot = {
    chatId: readMark.chatId,
    lastReadMs: Number.isNaN(read) ? Number.NEGATIVE_INFINITY : read,
    unreadCount: readMark.unreadCount,
    newestAtOpenMs: messages.reduce(
      (newest, message) => Math.max(newest, timeMs(message.createdAt) || 0),
      Number.NEGATIVE_INFINITY
    ),
    pagesLoaded: 0,
    settled: true,
  };
  snapshot.settled = !(
    canLoadOlder && needsOlderForUnread(messages, snapshot, currentUserId, hasOlder)
  );
  return snapshot;
}

/**
 * Первое непрочитанное из тех, что были при открытии. Пришедшие потом
 * разделителя не двигают: они считаются на кнопке «вниз».
 *
 * Сервер не насчитал непрочитанных — разделителя нет. Часть непрочитанных
 * выше загруженного (догрузка упёрлась в потолок) — настоящее первое там:
 * разделитель не ставим, чтобы не соврать.
 */
export function findFirstUnreadId(
  messages: TMessagesList,
  snapshot: IUnreadSnapshot,
  currentUserId: string | undefined,
  hasOlder: boolean
): string | null {
  if (snapshot.unreadCount === 0) return null;
  if (hasUnreadAbove(messages, snapshot, currentUserId, hasOlder)) return null;
  return messages.find((message) => isUnreadAtOpen(message, snapshot, currentUserId))?.id ?? null;
}

type TCountable = { type: 'message'; message: IMessageDto } | { type: 'date' | 'unread' };

/**
 * Сколько новых ниже экрана — число на кнопке «вниз»: чужие после
 * разделителя и пришедшие после открытия. Догруженная сверху история
 * новой не считается.
 */
export function countUnreadBelow(
  items: readonly TCountable[],
  lastVisibleIndex: number,
  snapshot: IUnreadSnapshot | null,
  currentUserId?: string
): number {
  if (!snapshot) return 0;
  const anchor = items.findIndex((item) => item.type === 'unread');
  let count = 0;
  for (let index = lastVisibleIndex + 1; index < items.length; index++) {
    const item = items[index];
    if (item.type !== 'message' || !isIncoming(item.message, currentUserId)) continue;
    const afterDivider = anchor !== -1 && index > anchor;
    if (afterDivider || timeMs(item.message.createdAt) > snapshot.newestAtOpenMs) count++;
  }
  return count;
}

/**
 * Куда встать при открытии: разделитель — к верхнему краю; первое
 * непрочитанное дальше потолка догрузки — на верх загруженного; иначе вниз.
 */
export function openingScrollTarget(
  items: readonly TCountable[],
  capped: boolean
): { index: number; align: 'start' | 'end' } {
  const anchor = items.findIndex((item) => item.type === 'unread');
  if (anchor !== -1) return { index: anchor, align: 'start' };
  if (capped) return { index: 0, align: 'start' };
  return { index: items.length - 1, align: 'end' };
}

export function selectReadUpTo(
  items: readonly TCountable[],
  lastVisibleIndex: number,
  lastReadAt: string | null | undefined,
  currentUserId?: string
): IMessageDto[] {
  const readMs = timeMs(lastReadAt);
  return items
    .slice(0, lastVisibleIndex + 1)
    .flatMap((item) =>
      item.type === 'message' &&
      isIncoming(item.message, currentUserId) &&
      !item.message.isRead &&
      !(timeMs(item.message.createdAt) <= readMs)
        ? [item.message]
        : []
    );
}
