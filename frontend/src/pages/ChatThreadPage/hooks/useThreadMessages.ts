import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, type RefObject } from 'react';
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

  const loadOlder = useCallback(async () => {
    const container = containerRef.current;
    if (!container || !hasNextPage || isFetchingNextPage) return;

    // Прокрутка отсчитывается от низа: после вставки более старых сообщений
    // сверху высота вырастает, и без поправки лента прыгнула бы к началу.
    const previousHeight = container.scrollHeight;

    await fetchNextPage();

    requestAnimationFrame(() => {
      const current = containerRef.current;
      if (!current) return;
      current.scrollTop += current.scrollHeight - previousHeight;
    });
  }, [containerRef, fetchNextPage, hasNextPage, isFetchingNextPage]);

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
