import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { TMessagesList } from '@/types';
import { flattenThread } from './threadCache';
import { messagesQuery } from './threadQueries';

/**
 * История открытого чата для тех, кому она нужна только на чтение.
 *
 * Используется тот же запрос, что и на странице чата: подписчики на один
 * ключ дедуплицируются, поэтому лишнего обращения к серверу не будет —
 * компонент просто читает уже загруженную историю и перерисовывается,
 * когда она меняется.
 */
export function useThreadMessagesData(): TMessagesList {
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { data } = useInfiniteQuery(messagesQuery(chatId));

  return flattenThread(data);
}
