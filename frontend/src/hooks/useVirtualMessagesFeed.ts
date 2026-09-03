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

export function useVirtualMessagesFeed({ messages, messagesRef }: IUseVirtualMessagesFeedOptions) {
  const { t } = useTranslation();
  const internalContainerRef = useRef<HTMLElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
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

  /* Формирование списка элементов ленты с виртуализируемыми плашками дат */
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
    overscan: 25,
    useFlushSync: false,
    initialRect: { width: 1000, height: 1000 },
    observeElementRect: (instance, cb) => {
      const element = instance.scrollElement;
      if (!element) return undefined;
      const update = () => {
        const rect = element.getBoundingClientRect();
        const width = rect.width || 1000;
        const height = rect.height || element.clientHeight || 1000;
        cb({ width, height });
      };
      update();
      const observer =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
      observer?.observe(element);
      return () => observer?.disconnect();
    },
  });

  // Отслеживание позиции прокрутки для кнопки и флага нахождения внизу
  useEffect(() => {
    const container = internalContainerRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isScrolledUp = distanceFromBottom > SCROLL_THRESHOLD_PX;
      setShowScrollBottom(isScrolledUp);
      isNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

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
        const container = internalContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
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
        const container = internalContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, [feedItems, virtualizer]);

  const scrollToBottom = useCallback(() => {
    if (feedItems.length === 0) return;
    virtualizer.scrollToIndex(feedItems.length - 1, { align: 'end', behavior: 'smooth' });
    const container = internalContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [feedItems.length, virtualizer]);

  return {
    feedItems,
    messagesById,
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    setContainerRef,
    showScrollBottom,
    scrollToBottom,
  };
}
