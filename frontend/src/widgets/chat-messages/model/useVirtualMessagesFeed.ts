import type { IMediaItem, IMessageDto, TMessagesList } from '@/types';
import { formatDateDivider, isDifferentDay } from '@/shared/lib';
import { estimateMessageItemSize } from '@/entities/message';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

export type TFeedItem =
  | { id: string; type: 'date'; label: string }
  /** «Новые сообщения» — перед первым непрочитанным на момент открытия (#820). */
  | { id: string; type: 'unread' }
  | {
      id: string;
      type: 'message';
      message: IMessageDto;
      /** Первое сообщение в непрерывной цепочке одного автора. */
      isFirstInGroup: boolean;
      /** Последнее сообщение в группе — рисуется с «хвостиком» (срезанный угол). */
      isLastInGroup: boolean;
      /** Идёт сразу после сообщения другого автора (нужен увеличенный gap). */
      isDifferentAuthor: boolean;
    };

interface IUseVirtualMessagesFeedOptions {
  messages: TMessagesList;
  messagesRef?: RefObject<HTMLElement | null>;
  /** Кто читает: свои сообщения непрочитанными не бывают. */
  currentUserId?: string;
  /**
   * Отмечать ли новые: разделитель «Новые сообщения» и их число на кнопке
   * «вниз». В подборке закреплённых это не нужно.
   */
  trackUnread?: boolean;
}

/* Что было непрочитанным, когда чат открыли. Запоминается один раз на
   чат: сами сообщения отмечаются прочитанными сразу после загрузки, и
   без снимка разделитель исчез бы в первую же секунду. */
interface IUnreadSnapshot {
  chatId: string;
  firstUnreadId: string | null;
  /** Что уже было в ленте при открытии: пришедшее позже — тоже новое. */
  knownIds: Set<string>;
}

const SCROLL_THRESHOLD_PX = 200;
const NEAR_BOTTOM_THRESHOLD_PX = 150;
const DATE_HIDE_DELAY_MS = 1500;
const STICKY_COLLISION_HEIGHT_PX = 44;

export function useVirtualMessagesFeed({
  messages,
  messagesRef,
  currentUserId,
  trackUnread = true,
}: IUseVirtualMessagesFeedOptions) {
  const { t } = useTranslation();

  const chatId = messages[0]?.chatId;
  const [unread, setUnread] = useState<IUnreadSnapshot | null>(null);
  // Снимок делается при отрисовке, а не эффектом: иначе первый кадр
  // ленты вышел бы без разделителя и дёрнулся бы следующим.
  if (trackUnread && chatId && unread?.chatId !== chatId) {
    const first = messages.find(
      (message) => message.senderId !== currentUserId && message.isRead === false
    );
    setUnread({
      chatId,
      firstUnreadId: first?.id ?? null,
      knownIds: new Set(messages.map((message) => message.id)),
    });
  }
  const internalContainerRef = useRef<HTMLElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isScrollingState, setIsScrollingState] = useState(false);
  const [scrollPaddingRight, setScrollPaddingRight] = useState(0);
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
      if (node) {
        setScrollPaddingRight(Math.max(0, node.offsetWidth - node.clientWidth));
      }
    },
    [messagesRef]
  );

  // Измерение ширины полосы прокрутки для компенсации смещения стики-дивайдера
  useEffect(() => {
    const container = internalContainerRef.current;
    if (!container) return undefined;

    const updateScrollPadding = () => {
      const scrollbarWidth = Math.max(0, container.offsetWidth - container.clientWidth);
      setScrollPaddingRight(scrollbarWidth);
    };

    updateScrollPadding();

    const resizeObserver = new ResizeObserver(updateScrollPadding);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [setContainerRef]);

  /* Указатель на сообщения по ID для O(1) поиска превью цитирования */
  const messagesById = useMemo(() => {
    const index = new Map<string, IMediaItem>();
    for (const message of messages) index.set(message.id, message);
    return index;
  }, [messages]);

  /* Формирование элементов ленты с инлайн-разделителями между днями
     и расчётом непрерывных групп одного автора (Telegram-стиль). */
  const feedItems = useMemo<TFeedItem[]>(() => {
    /* 1. Сообщения + разделители дат */
    const raw: Array<
      | { type: 'date'; id: string; label: string }
      | { type: 'unread'; id: string }
      | { type: 'message'; id: string; message: IMessageDto }
    > = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const prevMessage = i > 0 ? messages[i - 1] : undefined;

      if (!prevMessage || isDifferentDay(prevMessage.createdAt, message.createdAt)) {
        const dateLabel = formatDateDivider(message.createdAt, t);
        if (dateLabel) {
          raw.push({
            id: `date-${String(message.createdAt).slice(0, 10)}-${i}`,
            type: 'date',
            label: dateLabel,
          });
        }
      }

      if (message.id === unread?.firstUnreadId) raw.push({ id: 'unread-divider', type: 'unread' });

      raw.push({ id: message.id, type: 'message', message });
    }

    /* 2. Группировка: вычисление флагов первого/последнего в группе одного автора */
    const items: TFeedItem[] = [];
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      if (entry.type !== 'message') {
        items.push(entry);
      } else {
        const prev = i > 0 ? raw[i - 1] : null;
        const next = i < raw.length - 1 ? raw[i + 1] : null;
        const sameAsPrev =
          prev?.type === 'message' && prev.message.senderId === entry.message.senderId;
        const sameAsNext =
          next?.type === 'message' && next.message.senderId === entry.message.senderId;
        const isDifferentAuthor =
          prev?.type === 'message' && prev.message.senderId !== entry.message.senderId;

        items.push({
          ...entry,
          isFirstInGroup: !sameAsPrev,
          isLastInGroup: !sameAsNext,
          isDifferentAuthor,
        });
      }
    }

    return items;
  }, [messages, t, unread?.firstUnreadId]);

  const virtualizer = useVirtualizer({
    count: feedItems.length,
    getScrollElement: () => internalContainerRef.current,
    estimateSize: useCallback(
      (index: number) => estimateMessageItemSize(feedItems[index]),
      [feedItems]
    ),
    getItemKey: useCallback(
      (index: number) => feedItems[index]?.id ?? `item-${index}`,
      [feedItems]
    ),
    gap: 4,
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

  /* Сколько новых ниже экрана — число на кнопке «вниз». Новые — чужие,
     что были непрочитанными при открытии, и пришедшие после. */
  const lastVisibleIndex = virtualizer.range?.endIndex ?? feedItems.length - 1;
  const unreadBelow = useMemo(() => {
    if (!unread) return 0;
    const anchor = feedItems.findIndex((item) => item.type === 'unread');
    let count = 0;
    for (let index = lastVisibleIndex + 1; index < feedItems.length; index++) {
      const item = feedItems[index];
      if (item.type !== 'message' || item.message.senderId === currentUserId) continue;
      const isFresh = (anchor !== -1 && index > anchor) || !unread.knownIds.has(item.id);
      if (isFresh) count++;
    }
    return count;
  }, [feedItems, lastVisibleIndex, unread, currentUserId]);

  // Расчёт стики-поведения в стиле Telegram: выталкивание следующим дивайдером и активная дата
  const { activeDate, stickyPushOffset, isInlineAtTop } = useMemo(() => {
    if (virtualItems.length === 0) {
      return { activeDate: '', stickyPushOffset: 0, isInlineAtTop: false };
    }

    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const firstRow = virtualItems[0];
    /* Разделитель «Новые сообщения» даты не несёт — берётся следующий
       за ним элемент. */
    const firstItem =
      feedItems[firstRow.index]?.type === 'unread'
        ? feedItems[firstRow.index + 1]
        : feedItems[firstRow.index];

    let dateText = '';
    if (firstItem?.type === 'date') {
      dateText = firstItem.label;
    } else if (firstItem?.type === 'message') {
      dateText = formatDateDivider(firstItem.message.createdAt, t);
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

  const feedItemsRef = useRef(feedItems);
  useEffect(() => {
    feedItemsRef.current = feedItems;
  }, [feedItems]);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      if (!messageId) return false;
      const targetIndex = feedItemsRef.current.findIndex((item) => item.id === messageId);
      if (targetIndex !== -1) {
        virtualizer.scrollToIndex(targetIndex, { align: 'center', behavior: 'smooth' });
        return true;
      }
      return false;
    },
    [virtualizer]
  );

  return {
    activeDate,
    isStickyVisible,
    stickyPushOffset,
    scrollPaddingRight,
    feedItems,
    messagesById,
    virtualizer,
    virtualItems,
    setContainerRef,
    showScrollBottom,
    unreadBelow,
    scrollToBottom,
    jumpToMessage,
  };
}
