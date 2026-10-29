import { infiniteQueryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { messageKeys } from './messageKeys';
import type { IReactionAuthorsPage } from './types';

export const REACTION_AUTHORS_PAGE_SIZE = 50;

/**
 * Сводный запрос списка пользователей для вкладки «Все» в модалке (#998).
 */
export function reactionAuthorsSummaryQuery(messageId: string, emoji: string) {
  return {
    queryKey: messageKeys.reactionAuthorsSummary(messageId, emoji),
    queryFn: () =>
      services.messageService.listReactionAuthors(
        messageId,
        emoji,
        undefined,
        REACTION_AUTHORS_PAGE_SIZE
      ),
    staleTime: 30_000,
  };
}

/**
 * Курсорный запрос списка пользователей, поставивших реакцию (#998, #709).
 */
export function reactionAuthorsQuery(messageId: string, emoji: string) {
  return infiniteQueryOptions<IReactionAuthorsPage>({
    queryKey: messageKeys.reactionAuthors(messageId, emoji),
    queryFn: ({ pageParam }) =>
      services.messageService.listReactionAuthors(
        messageId,
        emoji,
        pageParam ? String(pageParam) : undefined,
        REACTION_AUTHORS_PAGE_SIZE
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    staleTime: 30_000,
  });
}
