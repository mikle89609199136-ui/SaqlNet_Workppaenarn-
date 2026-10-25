import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { EMPTY_THREAD, messagesQuery } from '@/entities/message';

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
 *
 * Ради исходника цитаты история при открытии не догружается: его текст
 * приходит с сервера в превью ответа (#1065). Прежняя догрузка (#553)
 * вставала над лентой, и длинный чат открывался посередине.
 */
export function useThreadMessages({ chatId, containerRef }: IUseThreadMessagesOptions) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(messagesQuery(chatId));

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const inFlightPromiseRef = useRef<Promise<unknown> | null>(null);

  const loadOlder = useCallback(
    async (options?: { isJump?: boolean }) => {
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
    error: query.error
      ? ((query.error as Error).message ??
        t('errors.messagesLoad', 'Не удалось загрузить сообщения'))
      : '',
    loadOlder,
  };
}
