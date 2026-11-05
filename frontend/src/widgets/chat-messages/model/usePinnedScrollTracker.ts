import { useEffect } from 'react';
import { useChatUiStore } from '@/entities/chat';
import type { TPinnedList } from '@/types';
import type { TFeedItem } from './useVirtualMessagesFeed';

interface VirtualItemLike {
  index: number;
}

interface FindActivePinnedParams {
  pinnedMessages: TPinnedList;
  feedItems: TFeedItem[];
  virtualItems: VirtualItemLike[];
}

/**
 * Вычисляет активный ID закрепления на основе текущей видимой области ленты сообщений (#1057).
 *
 * Алгоритм (в стиле Telegram):
 * 1. Если на экране видно одно или несколько закреплений — активным считается верхнее видимое.
 * 2. Если на экране нет закреплений — берётся последнее пройденное закрепление выше видимой зоны
 *    (контекст истории переписки, в которой находится пользователь).
 * 3. Если скролл выше всех закреплений истории — удерживается первое (самое раннее).
 * 4. Если скролл ниже всех закреплений истории — удерживается последнее (самое свежее).
 */
export function findActivePinnedMessageId({
  pinnedMessages,
  feedItems,
  virtualItems,
}: FindActivePinnedParams): string | null {
  if (!pinnedMessages || pinnedMessages.length === 0) return null;
  if (pinnedMessages.length === 1) {
    return pinnedMessages[0].messageId || pinnedMessages[0].message?.id || null;
  }
  if (!virtualItems || virtualItems.length === 0 || !feedItems || feedItems.length === 0) {
    return null;
  }

  // Индексируем сообщения ленты по ID: ID -> index в feedItems
  const feedIndexByMsgId = new Map<string, number>();
  let oldestLoadedTime = Infinity;

  for (let i = 0; i < feedItems.length; i++) {
    const item = feedItems[i];
    if (item.type === 'message' && item.message) {
      feedIndexByMsgId.set(item.id, i);
      if (item.message.id) feedIndexByMsgId.set(item.message.id, i);

      const msgTime = item.message.createdAt ? new Date(item.message.createdAt).getTime() : 0;
      if (msgTime > 0 && msgTime < oldestLoadedTime) {
        oldestLoadedTime = msgTime;
      }
    }
  }

  const firstVisibleIdx = virtualItems[0].index;
  const lastVisibleIdx = virtualItems[virtualItems.length - 1].index;

  const pinInfos = pinnedMessages.map((pin, pinIdx) => {
    const id = pin.messageId || pin.message?.id || '';
    const feedIdx = feedIndexByMsgId.get(id);
    const createdAt = pin.message?.createdAt ? new Date(pin.message.createdAt).getTime() : 0;
    return { id, pinIdx, feedIdx, createdAt };
  });

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
    // Берём ближайший пройденный пин (последний из предшествующих)
    return passedPins[passedPins.length - 1].id;
  }

  // 3. Пользователь прокрутил выше всех пинов истории — удерживаем самый ранний
  return pinInfos[0].id;
}

interface UsePinnedScrollTrackerParams {
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
      feedItems,
      virtualItems,
    });

    if (targetId && targetId !== activePinnedId) {
      setActivePinnedId(targetId);
    }
  }, [
    pinnedMessages,
    feedItems,
    virtualItems,
    activePinnedId,
    setActivePinnedId,
    pinnedNavLockUntil,
  ]);
}
