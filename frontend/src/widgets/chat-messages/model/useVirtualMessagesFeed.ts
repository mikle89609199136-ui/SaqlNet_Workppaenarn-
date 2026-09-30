import type { IMediaItem, IMessageDto, TMessagesList } from '@/types';
import { formatDateDivider, isDifferentDay, usePageVisible } from '@/shared/lib';
import { estimateMessageItemSize } from '@/entities/message';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  countUnreadBelow,
  findFirstUnreadId,
  hasUnreadAbove,
  needsOlderForUnread,
  openingScrollTarget,
  selectReadUpTo,
  takeUnreadSnapshot,
  type IReadMark,
  type IUnreadSnapshot,
} from './unread';

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
  /**
   * Отметка прочтения открытого чата (#839): по ней при открытии ставится
   * «Новые сообщения» и лента встаёт на них. Пока её нет — лента ждёт.
   */
  readMark?: IReadMark;
  /** Догрузка истории — при открытии до первого непрочитанного. */
  loadOlder?: (options?: { isJump?: boolean }) => Promise<void> | void;
  hasOlder?: boolean;
  onMessagesSeen?: (messages: IMessageDto[]) => void;
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
  readMark,
  loadOlder,
  hasOlder = false,
  onMessagesSeen,
}: IUseVirtualMessagesFeedOptions) {
  const { t } = useTranslation();

  const chatId = messages[0]?.chatId;
  const [unread, setUnread] = useState<IUnreadSnapshot | null>(null);
  // Снимок делается при отрисовке, а не эффектом: иначе первый кадр
  // ленты вышел бы без разделителя и дёрнулся бы следующим.
  if (trackUnread && chatId && unread?.chatId !== chatId && readMark?.chatId === chatId) {
    setUnread(takeUnreadSnapshot(messages, readMark, currentUserId, hasOlder, Boolean(loadOlder)));
  }
  const snapshot = unread?.chatId === chatId ? unread : null;
  const firstUnreadId = useMemo(
    () => (snapshot ? findFirstUnreadId(messages, snapshot, currentUserId, hasOlder) : null),
    [messages, snapshot, currentUserId, hasOlder]
  );

  /* Первое непрочитанное старше загруженного — догрузить до него, как при
     переходе к сообщению, но не больше потолка. */
  const loadingOlderRef = useRef(false);
  useEffect(() => {
    if (!snapshot || snapshot.settled || loadingOlderRef.current) return;
    if (!loadOlder || !needsOlderForUnread(messages, snapshot, currentUserId, hasOlder)) {
      setUnread((current) =>
        current?.chatId === snapshot.chatId ? { ...current, settled: true } : current
      );
      return;
    }
    loadingOlderRef.current = true;
    void Promise.resolve(loadOlder({ isJump: true }))
      .catch(() => {})
      .finally(() => {
        loadingOlderRef.current = false;
        setUnread((current) =>
          current?.chatId === snapshot.chatId
            ? { ...current, pagesLoaded: current.pagesLoaded + 1 }
            : current
        );
      });
  }, [snapshot, messages, currentUserId, hasOlder, loadOlder]);
  const internalContainerRef = useRef<HTMLElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isScrollingState, setIsScrollingState] = useState(false);
  const [scrollPaddingRight, setScrollPaddingRight] = useState(0);
  const dateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNearBottomRef = useRef(true);

  /** Чат, в котором лента уже встала на место при открытии. */
  const openedChatRef = useRef<string | null>(null);
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);

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

      if (message.id === firstUnreadId) raw.push({ id: 'unread-divider', type: 'unread' });

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
  }, [messages, t, firstUnreadId]);

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

  /* Умный скролл: при открытии — на «Новые сообщения» или вниз, вниз при
     новых сообщениях, позиция сохраняется при подгрузке старых сверху. */
  useEffect(() => {
    if (feedItems.length === 0) return;

    const firstItem = feedItems[0];
    const lastItem = feedItems[feedItems.length - 1];

    const prevFirstId = prevFirstIdRef.current;
    const prevLastId = prevLastIdRef.current;

    prevFirstIdRef.current = firstItem.id;
    prevLastIdRef.current = lastItem.id;

    // 1. Открытие чата — и первое, и смена чата без перемонтирования (#839).
    //    Встаём один раз, когда снимок снят и история догружена.
    if (openedChatRef.current !== chatId) {
      if (trackUnread && !snapshot?.settled) return;
      openedChatRef.current = chatId ?? null;
      const capped = snapshot ? hasUnreadAbove(messages, snapshot, currentUserId, hasOlder) : false;
      const target = openingScrollTarget(feedItems, capped);
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(target.index, { align: target.align, behavior: 'auto' });
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
  }, [feedItems, virtualizer, chatId, trackUnread, snapshot, hasOlder, messages, currentUserId]);

  const scrollToBottom = useCallback(() => {
    if (feedItems.length === 0) return;
    virtualizer.scrollToIndex(feedItems.length - 1, { align: 'end', behavior: 'smooth' });
  }, [feedItems.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  const isPageVisible = usePageVisible();
  const lastSeenIndex = virtualizer.range?.endIndex ?? -1;
  const seenReadMark = readMark?.chatId === chatId ? readMark?.lastReadAt : undefined;
  const canReportSeen = isPageVisible && (!trackUnread || Boolean(snapshot?.settled));
  useEffect(() => {
    if (!onMessagesSeen || !canReportSeen || lastSeenIndex < 0) return;
    const seen = selectReadUpTo(feedItems, lastSeenIndex, seenReadMark, currentUserId);
    if (seen.length > 0) onMessagesSeen(seen);
  }, [canReportSeen, currentUserId, feedItems, lastSeenIndex, onMessagesSeen, seenReadMark]);

  /* Сколько новых ниже экрана — число на кнопке «вниз». */
  const lastVisibleIndex = virtualizer.range?.endIndex ?? feedItems.length - 1;
  const unreadBelow = useMemo(
    () => countUnreadBelow(feedItems, lastVisibleIndex, snapshot, currentUserId),
    [feedItems, lastVisibleIndex, snapshot, currentUserId]
  );

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
