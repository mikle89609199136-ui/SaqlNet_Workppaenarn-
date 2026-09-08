import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { messagesQuery } from '@/queries/chat/threadQueries';
import { EMPTY_THREAD } from '@/queries/chat/threadCache';

/** На каком расстоянии от верха начинать подгружать более старые сообщения. */
const LOAD_MORE_THRESHOLD_PX = 50;

interface IUseThreadMessagesOptions {
  chatId: string;
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * История чата и её подгрузка при прокрутке вверх.
 *
 * Каждый чат хранится под своим ключом, поэтому запоздавший ответ попадает
 * в кеш своего чата и в чужую ленту не проходит. Раньше это сторожила
 * ручная проверка идентификатора, которая не срабатывала при смене чата:
 * компонент перемонтировался, и сравнение шло с собственным значением
 * старого экземпляра (#258).
 */
export function useThreadMessages({ chatId, containerRef }: IUseThreadMessagesOptions) {
  const query = useInfiniteQuery(messagesQuery(chatId));

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const inFlightPromiseRef = useRef<Promise<unknown> | null>(null);
  const preloadedChatIdRef = useRef<string | null>(null);

  const loadOlder = useCallback(
    async (options?: { isJump?: boolean; isPreload?: boolean }) => {
      if (inFlightPromiseRef.current) {
        await inFlightPromiseRef.current;
        return;
      }
      if (!hasNextPage) return;

      const container = containerRef.current;
      const isJump = options?.isJump;
      const previousHeight = container ? container.scrollHeight : 0;

      const promise = (async () => {
        try {
          await fetchNextPage();
        } finally {
          inFlightPromiseRef.current = null;
        }
      })();

      inFlightPromiseRef.current = promise;
      await promise;

      // При переходе к сообщению (isJump) прокрутку настраивает jumpToMessage через virtualizer.
      // Поправка scrollTop здесь сломала бы сглаживание перехода и вызвала рывок.
      if (!isJump && container) {
        requestAnimationFrame(() => {
          const current = containerRef.current;
          if (!current) return;
          current.scrollTop += current.scrollHeight - previousHeight;
        });
      }
    },
    [containerRef, fetchNextPage, hasNextPage]
  );

  const preloadCountRef = useRef(0);

  // Сброс отметки автоподгрузки при смене чата
  useEffect(() => {
    if (preloadedChatIdRef.current !== chatId) {
      preloadedChatIdRef.current = chatId;
      preloadCountRef.current = 0;
    }
  }, [chatId]);

  // Проверяем, есть ли среди загруженных сообщений ответы на сообщения вне текущего среза
  const hasUnresolvedReplies = useCallback(() => {
    if (!query.data || query.data.length === 0) return false;
    const knownIds = new Set(query.data.map((m) => m.id));
    return query.data.some((msg) => {
      const replyId = msg.replyTo || msg.replyToMessageId;
      return Boolean(replyId && !knownIds.has(replyId));
    });
  }, [query.data]);

  // Подгрузка истории сразу при загрузке чата после показа первых 50 сообщений,
  // если есть цитируемые сообщения, оставшиеся за пределами текущего среза (#553)
  useEffect(() => {
    if (
      chatId &&
      !query.isPending &&
      query.data &&
      query.data.length > 0 &&
      hasNextPage &&
      !isFetchingNextPage &&
      preloadCountRef.current < 2 &&
      hasUnresolvedReplies()
    ) {
      preloadCountRef.current += 1;
      void loadOlder({ isPreload: true });
    }
  }, [
    chatId,
    query.isPending,
    query.data,
    hasNextPage,
    isFetchingNextPage,
    hasUnresolvedReplies,
    loadOlder,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onScroll = () => {
      const hasOverflow = container.scrollHeight > container.clientHeight;
      if (hasOverflow && container.scrollTop <= LOAD_MORE_THRESHOLD_PX) {
        void loadOlder();
      }
    };

    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, [containerRef, loadOlder]);

  return {
    // Общая пустая лента, а не новый литерал: до первой загрузки ссылка
    // тоже обязана оставаться прежней.
    messages: query.data ?? EMPTY_THREAD,
    isLoading: query.isPending,
    isLoadingOlder: isFetchingNextPage,
    hasOlder: Boolean(hasNextPage),
    error: query.error ? ((query.error as Error).message ?? 'Не удалось загрузить сообщения') : '',
    loadOlder,
  };
}
