import { useEffect, useMemo } from 'react';
import { useChatUiStore } from '@/entities/chat';
import type { TPinnedList } from '@/types';
import type { TFeedItem } from './useVirtualMessagesFeed';

/**
 * Строки ленты, которые действительно на экране (#1057): `virtualizer.range`,
 * а не `getVirtualItems()`. Виртуальные строки включают overscan — по восемь
 * строк за краями окна, — и закрепление за кадром считалось бы видимым.
 */
export interface IVisibleRange {
  startIndex: number;
  endIndex: number;
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

/** Раньше в истории: по месту в ленте, у недогруженных — по времени сообщения. */
function compareByHistory(a: PinnedScrollPinInfo, b: PinnedScrollPinInfo): number {
  if (a.feedIdx !== undefined && b.feedIdx !== undefined) return a.feedIdx - b.feedIdx;
  return a.createdAt - b.createdAt;
}

export interface FindActivePinnedParams {
  pinnedMessages?: TPinnedList;
  feedItems?: TFeedItem[];
  visibleRange: IVisibleRange | null;
  metadata?: PinnedScrollMetadata;
  /** Закрепление, которое плашка показывает сейчас. */
  currentId?: string | null;
}

/**
 * Вычисляет активный ID закрепления по видимой области ленты (#1057).
 *
 * 1. Показанное закрепление остаётся, пока оно на экране. Иначе после клика
 *    по плашке лента встаёт на цель, а первый же тик прокрутки перебрасывал бы
 *    плашку на соседнее закрепление, оказавшееся в том же кадре.
 * 2. Иначе из видимых берётся нижнее — ближайшее к месту, где человек читает:
 *    внизу чата это самое свежее закрепление, а не то, что едва видно сверху.
 * 3. На экране закреплений нет — ближайшее пройденное выше видимой зоны
 *    (контекст истории). Не догруженные в ленту сообщения сравниваются по времени.
 * 4. Прокрутка выше всех закреплений — самое раннее в истории.
 */
export function findActivePinnedMessageId({
  pinnedMessages,
  feedItems,
  visibleRange,
  metadata,
  currentId,
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
  if (!visibleRange) return null;

  const { startIndex, endIndex } = visibleRange;

  const visiblePins = pinInfos.filter(
    (p) => p.feedIdx !== undefined && p.feedIdx >= startIndex && p.feedIdx <= endIndex
  );

  if (currentId && visiblePins.some((p) => p.id === currentId)) {
    return currentId;
  }

  if (visiblePins.length > 0) {
    return visiblePins.reduce((lowest, p) =>
      (p.feedIdx ?? 0) > (lowest.feedIdx ?? 0) ? p : lowest
    ).id;
  }

  const passedPins = pinInfos.filter((p) => {
    if (p.feedIdx !== undefined) return p.feedIdx < startIndex;
    // Сообщение ещё не подгружено в ленту: выше экрана, если старше загруженного
    return p.createdAt > 0 && p.createdAt < oldestLoadedTime;
  });

  if (passedPins.length > 0) {
    // Ближайший к экрану: загруженные в ленте ближе недогруженных
    return passedPins.reduce((nearest, p) => {
      if (p.feedIdx !== undefined && nearest.feedIdx === undefined) return p;
      if (p.feedIdx === undefined && nearest.feedIdx !== undefined) return nearest;
      return compareByHistory(p, nearest) > 0 ? p : nearest;
    }).id;
  }

  return pinInfos.reduce((earliest, p) => (compareByHistory(p, earliest) < 0 ? p : earliest)).id;
}

export interface UsePinnedScrollTrackerParams {
  pinnedMessages?: TPinnedList;
  feedItems: TFeedItem[];
  visibleRange: IVisibleRange | null;
}

/**
 * Хук отслеживания видимого закрепления при скролле ленты сообщений (#1057).
 */
export function usePinnedScrollTracker({
  pinnedMessages,
  feedItems,
  visibleRange,
}: UsePinnedScrollTrackerParams): void {
  const activePinnedId = useChatUiStore((state) => state.activePinnedId);
  const setActivePinnedId = useChatUiStore((state) => state.setActivePinnedId);
  const pinnedNavLockUntil = useChatUiStore((state) => state.pinnedNavLockUntil);
  const setPinnedNavLockUntil = useChatUiStore((state) => state.setPinnedNavLockUntil);

  // Мемоизируем метаданные закреплений по ссылке на [pinnedMessages, feedItems] (#1057)
  const metadata = useMemo(() => {
    if (!pinnedMessages || pinnedMessages.length === 0 || !feedItems || feedItems.length === 0) {
      return { pinInfos: [], oldestLoadedTime: Infinity };
    }
    return buildPinnedScrollMetadata(pinnedMessages, feedItems);
  }, [pinnedMessages, feedItems]);

  // Объект range пересоздаётся виртуализатором; эффекту нужны только границы
  const startIndex = visibleRange?.startIndex ?? -1;
  const endIndex = visibleRange?.endIndex ?? -1;

  useEffect(() => {
    if (!pinnedMessages || pinnedMessages.length === 0) {
      if (activePinnedId !== null) {
        setActivePinnedId(null);
      }
      return;
    }

    if (startIndex < 0 || endIndex < 0) return;

    // После клика по плашке лента едет к цели плавно и по пути показывает
    // другие закрепления. Пока цель не на экране, плашку не трогаем; когда
    // доехала — её удерживает правило «показанное остаётся, пока видно».
    // Срок блокировки — лишь предел ожидания, если цель так и не появилась.
    if (Date.now() < pinnedNavLockUntil) {
      const targetVisible = metadata.pinInfos.some(
        (p) =>
          p.id === activePinnedId &&
          p.feedIdx !== undefined &&
          p.feedIdx >= startIndex &&
          p.feedIdx <= endIndex
      );
      if (!targetVisible) return;
      // Доехали: дальше прокрутку ведёт человек, ждать срока незачем
      setPinnedNavLockUntil(0);
    }

    const targetId = findActivePinnedMessageId({
      pinnedMessages,
      visibleRange: { startIndex, endIndex },
      metadata,
      currentId: activePinnedId,
    });

    if (targetId && targetId !== activePinnedId) {
      setActivePinnedId(targetId);
    }
  }, [
    pinnedMessages,
    startIndex,
    endIndex,
    metadata,
    activePinnedId,
    setActivePinnedId,
    pinnedNavLockUntil,
    setPinnedNavLockUntil,
  ]);
}
