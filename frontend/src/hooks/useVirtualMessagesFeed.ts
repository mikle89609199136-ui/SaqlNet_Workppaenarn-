import type { IMediaItem, IMessageDto, TMessagesList } from '@/types';
import { formatDateDivider, isDifferentDay } from '@/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

export type TFeedItem =
  | { id: string; type: 'date'; label: string }
  | { id: string; type: 'message'; message: IMessageDto };

interface IUseVirtualMessagesFeedOptions {
  messages: TMessagesList;
  messagesRef?: RefObject<HTMLElement | null>;
}

const SCROLL_THRESHOLD_PX = 200;
const NEAR_BOTTOM_THRESHOLD_PX = 150;
const DATE_HIDE_DELAY_MS = 1500;
const STICKY_COLLISION_HEIGHT_PX = 44;

export function useVirtualMessagesFeed({ messages, messagesRef }: IUseVirtualMessagesFeedOptions) {
  const { t } = useTranslation();
  const internalContainerRef = useRef<HTMLElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isScrollingState, setIsScrollingState] = useState(false);
  const dateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNearBottomRef = useRef(true);

  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);

  const setContainerRef = useCallback(
    (node: HTMLElement | null) => {
      internalContainerRef.current = node;
      if (messagesRef) {
        (messagesRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    [messagesRef]
  );

  /* Указатель на сообщения по ID для O(1) поиска превью цитирования */
  const messagesById = useMemo(() => {
    const index = new Map<string, IMediaItem>();
    for (const message of messages) index.set(message.id, message);
    return index;
  }, [messages]);

  /* Формирование элементов ленты с инлайн-разделителями между днями */
  const feedItems = useMemo<TFeedItem[]>(() => {
    const items: TFeedItem[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const prevMessage = i > 0 ? messages[i - 1] : undefined;

      if (!prevMessage || isDifferentDay(prevMessage.createdAt, message.createdAt)) {
        const dateLabel = formatDateDivider(message.createdAt, t);
        if (dateLabel) {
          items.push({
            id: `date-${String(message.createdAt).slice(0, 10)}-${i}`,
            type: 'date',
            label: dateLabel,
          });
        }
      }

      items.push({
        id: message.id,
        type: 'message',
        message,
      });
    }
    return items;
  }, [messages, t]);

  const virtualizer = useVirtualizer({
    count: feedItems.length,
    getScrollElement: () => internalContainerRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const item = feedItems[index];
        if (!item) return 72;
        if (item.type === 'date') return 44;
        if (item.message.mediaUrl) return 240;
        return 72;
      },
      [feedItems]
    ),
    getItemKey: useCallback(
      (index: number) => feedItems[index]?.id ?? `item-${index}`,
      [feedItems]
    ),
    gap: 10,
    overscan: 8,
    useFlushSync: false,
  });

  const triggerDateVisibility = useCallback(() => {
    setIsScrollingState(true);
    if (dateTimerRef.current) clearTimeout(dateTimerRef.current);
    dateTimerRef.current = setTimeout(() => {
      setIsScrollingState(false);
    }, DATE_HIDE_DELAY_MS);
  }, []);

  // Показ плашки даты на 1.5с при первой загрузке сообщений
  useEffect(() => {
    if (messages.length > 0) {
      triggerDateVisibility();
    }
  }, [messages.length, triggerDateVisibility]);

  // Отслеживание прокрутки для кнопки «Вниз» и отображения даты
  useEffect(() => {
    const container = internalContainerRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isScrolledUp = distanceFromBottom > SCROLL_THRESHOLD_PX;
      setShowScrollBottom(isScrolledUp);
      isNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;

      triggerDateVisibility();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (dateTimerRef.current) clearTimeout(dateTimerRef.current);
    };
  }, [triggerDateVisibility]);

  // Умный скролл: вниз при открытии чата и новых сообщениях, сохранение позиции при подгрузке старых сверху
  useEffect(() => {
    if (feedItems.length === 0) return;

    const firstItem = feedItems[0];
    const lastItem = feedItems[feedItems.length - 1];

    const prevFirstId = prevFirstIdRef.current;
    const prevLastId = prevLastIdRef.current;
    const prevCount = prevCountRef.current;

    prevFirstIdRef.current = firstItem.id;
    prevLastIdRef.current = lastItem.id;
    prevCountRef.current = feedItems.length;

    // 1. Первый вход в чат / монтирование
    if (prevCount === 0 || !prevLastId) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(feedItems.length - 1, {
          align: 'end',
          behavior: 'auto',
        });
      });
      return;
    }

    // 2. Подгрузка старых сообщений сверху — запрещаем скролл вниз
    const isPrependingOlder = firstItem.id !== prevFirstId && lastItem.id === prevLastId;
    if (isPrependingOlder) {
      return;
    }

    // 3. Поступление нового сообщения в конец ленты
    const isNewMessageAtBottom = lastItem.id !== prevLastId;
    if (isNewMessageAtBottom && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(feedItems.length - 1, {
          align: 'end',
          behavior: 'smooth',
        });
      });
    }
  }, [feedItems, virtualizer]);

  const scrollToBottom = useCallback(() => {
    if (feedItems.length === 0) return;
    virtualizer.scrollToIndex(feedItems.length - 1, { align: 'end', behavior: 'smooth' });
  }, [feedItems.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  // Расчёт стики-поведения в стиле Telegram: выталкивание следующим дивайдером и активная дата
  const { activeDate, stickyPushOffset, isInlineAtTop } = useMemo(() => {
    if (virtualItems.length === 0) {
      return { activeDate: '', stickyPushOffset: 0, isInlineAtTop: false };
    }

    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const firstRow = virtualItems[0];
    const firstItem = feedItems[firstRow.index];

    let dateText = '';
    if (firstItem) {
      dateText =
        firstItem.type === 'date'
          ? firstItem.label
          : formatDateDivider(firstItem.message.createdAt, t);
    }

    let pushOffset = 0;
    let inlineAtTop = false;

    for (let i = 0; i < virtualItems.length; i++) {
      const row = virtualItems[i];
      const item = feedItems[row.index];
      if (item?.type === 'date') {
        const distFromTop = row.start - scrollOffset;
        if (distFromTop >= -5 && distFromTop <= 15) {
          inlineAtTop = true;
        }
        // Если следующий инлайн-дивайдер приближается сверху — выталкивает стики-плашку
        if (distFromTop > 0 && distFromTop < STICKY_COLLISION_HEIGHT_PX) {
          pushOffset = distFromTop - STICKY_COLLISION_HEIGHT_PX;
        }
      }
    }

    return {
      activeDate: dateText,
      stickyPushOffset: pushOffset,
      isInlineAtTop: inlineAtTop,
    };
  }, [virtualItems, feedItems, virtualizer.scrollOffset, t]);

  const isStickyVisible = Boolean(activeDate) && isScrollingState && !isInlineAtTop;

  return {
    activeDate,
    isStickyVisible,
    stickyPushOffset,
    feedItems,
    messagesById,
    virtualizer,
    virtualItems,
    setContainerRef,
    showScrollBottom,
    scrollToBottom,
  };
}
