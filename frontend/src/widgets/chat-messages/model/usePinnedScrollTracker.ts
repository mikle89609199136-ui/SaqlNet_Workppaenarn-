import { useEffect, useMemo } from 'react';
import { useChatUiStore } from '@/entities/chat';
import type { TPinnedList } from '@/types';
import type { TFeedItem } from './useVirtualMessagesFeed';

export interface VirtualItemLike {
  index: number;
}

export interface PinnedScrollPinInfo {
  id: string;
  pinIdx: number;
  feedIdx?: number;
  createdAt: number;
}

export interface PinnedScrollMetadata {
  pinInfos: PinnedScrollPinInfo[];
  oldestLoadedTime: number;
}

/**
 * Строит метаданные закреплений и их позиции в ленте feedItems (#1057).
 * Вынесено для мемоизации и исключения лишних аллокаций Map/Date на каждый тик скролла.
 */
export function buildPinnedScrollMetadata(
  pinnedMessages: TPinnedList,
  feedItems: TFeedItem[]
): PinnedScrollMetadata {
  if (!pinnedMessages || pinnedMessages.length === 0 || !feedItems || feedItems.length === 0) {
    return { pinInfos: [], oldestLoadedTime: Infinity };
  }

  const targetPinIds = new Set<string>();
  for (let i = 0; i < pinnedMessages.length; i++) {
    const id = pinnedMessages[i].messageId || pinnedMessages[i].message?.id;
    if (id) targetPinIds.add(id);
  }

  const feedIndexByMsgId = new Map<string, number>();
  let oldestLoadedTime = Infinity;

  for (let i = 0; i < feedItems.length; i++) {
    const item = feedItems[i];
    if (item.type === 'message' && item.message) {
      if (targetPinIds.has(item.id) || (item.message.id && targetPinIds.has(item.message.id))) {
        feedIndexByMsgId.set(item.id, i);
        if (item.message.id) feedIndexByMsgId.set(item.message.id, i);
      }

      const msgTime = item.message.createdAt ? new Date(item.message.createdAt).getTime() : 0;
      if (msgTime > 0 && msgTime < oldestLoadedTime) {
        oldestLoadedTime = msgTime;
      }
    }
  }

  const pinInfos: PinnedScrollPinInfo[] = pinnedMessages.map((pin, pinIdx) => {
    const id = pin.messageId || pin.message?.id || '';
    const feedIdx = feedIndexByMsgId.get(id);
    const createdAt = pin.message?.createdAt ? new Date(pin.message.createdAt).getTime() : 0;
    return { id, pinIdx, feedIdx, createdAt };
  });

  return { pinInfos, oldestLoadedTime };
}

export interface FindActivePinnedParams {
  pinnedMessages?: TPinnedList;
  feedItems?: TFeedItem[];
  virtualItems: VirtualItemLike[];
  metadata?: PinnedScrollMetadata;
}

/**
 * Вычисляет активный ID закрепления на основе текущей видимой области ленты сообщений (#1057).
 *
 * Алгоритм (в стиле Telegram):
 * 1. Если на экране видно одно или несколько закреплений — активным считается верхнее видимое.
 * 2. Если на экране нет закреплений — берётся ближайшее пройденное закрепление выше видимой зоны
 *    (контекст истории переписки, в которой находится пользователь). Сортируется по позиции в ленте / createdAt.
 * 3. Если скролл выше всех закреплений истории — удерживается первое (самое раннее).
 * 4. Если скролл ниже всех закреплений истории — удерживается последнее (самое свежее).
 */
export function findActivePinnedMessageId({
  pinnedMessages,
  feedItems,
  virtualItems,
  metadata,
}: FindActivePinnedParams): string | null {
  if (pinnedMessages && pinnedMessages.length === 1) {
    return pinnedMessages[0].messageId || pinnedMessages[0].message?.id || null;
  }

  const meta =
    metadata ??
    (pinnedMessages && feedItems
      ? buildPinnedScrollMetadata(pinnedMessages, feedItems)
      : { pinInfos: [], oldestLoadedTime: Infinity });

  const { pinInfos, oldestLoadedTime } = meta;

  if (!pinInfos || pinInfos.length === 0) return null;
  if (pinInfos.length === 1) return pinInfos[0].id || null;
  if (!virtualItems || virtualItems.length === 0) return null;

  const firstVisibleIdx = virtualItems[0].index;
  const lastVisibleIdx = virtualItems[virtualItems.length - 1].index;

  // 1. Проверяем, есть ли закрепления непосредственно в видимой области ленты
  const visiblePins = pinInfos.filter(
    (p) => p.feedIdx !== undefined && p.feedIdx >= firstVisibleIdx && p.feedIdx <= lastVisibleIdx
  );

  if (visiblePins.length > 0) {
    visiblePins.sort((a, b) => (a.feedIdx ?? 0) - (b.feedIdx ?? 0));
    return visiblePins[0].id;
  }

  // 2. Если пинов на экране нет — ищем пройденные пины выше видимой зоны
  const passedPins = pinInfos.filter((p) => {
    if (p.feedIdx !== undefined) {
      return p.feedIdx < firstVisibleIdx;
    }
    // Если сообщение пина ещё не подгружено в feedItems, сравниваем по времени
    return p.createdAt > 0 && p.createdAt < oldestLoadedTime;
  });

  if (passedPins.length > 0) {
    // Сортируем: ближайший к видимой зоне пин (максимальный feedIdx / максимальный createdAt)
    passedPins.sort((a, b) => {
      if (a.feedIdx !== undefined && b.feedIdx !== undefined) {
        return b.feedIdx - a.feedIdx;
      }
      if (a.feedIdx !== undefined) return -1;
      if (b.feedIdx !== undefined) return 1;
      return b.createdAt - a.createdAt;
    });
    return passedPins[0].id;
  }

  // 3. Пользователь прокрутил выше всех пинов истории — удерживаем самый ранний
  return pinInfos[0].id;
}

export interface UsePinnedScrollTrackerParams {
  pinnedMessages?: TPinnedList;
  feedItems: TFeedItem[];
  virtualItems: VirtualItemLike[];
}

/**
 * Хук отслеживания видимого закрепления при скролле ленты сообщений (#1057).
 */
export function usePinnedScrollTracker({
  pinnedMessages,
  feedItems,
  virtualItems,
}: UsePinnedScrollTrackerParams): void {
  const activePinnedId = useChatUiStore((state) => state.activePinnedId);
  const setActivePinnedId = useChatUiStore((state) => state.setActivePinnedId);
  const pinnedNavLockUntil = useChatUiStore((state) => state.pinnedNavLockUntil);

  // Мемоизируем метаданные закреплений по ссылке на [pinnedMessages, feedItems] (#1057)
  const metadata = useMemo(() => {
    if (!pinnedMessages || pinnedMessages.length === 0 || !feedItems || feedItems.length === 0) {
      return { pinInfos: [], oldestLoadedTime: Infinity };
    }
    return buildPinnedScrollMetadata(pinnedMessages, feedItems);
  }, [pinnedMessages, feedItems]);

  useEffect(() => {
    if (!pinnedMessages || pinnedMessages.length === 0) {
      if (activePinnedId !== null) {
        setActivePinnedId(null);
      }
      return;
    }

    if (!virtualItems || virtualItems.length === 0) return;

    // Защита от мерцания во время программного скролла по клику на плашку
    if (Date.now() < pinnedNavLockUntil) return;

    const targetId = findActivePinnedMessageId({
      pinnedMessages,
      virtualItems,
      metadata,
    });

    if (targetId && targetId !== activePinnedId) {
      setActivePinnedId(targetId);
    }
  }, [
    pinnedMessages,
    virtualItems,
    metadata,
    activePinnedId,
    setActivePinnedId,
    pinnedNavLockUntil,
  ]);
}
