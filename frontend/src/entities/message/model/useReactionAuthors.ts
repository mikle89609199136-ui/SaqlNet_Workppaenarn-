import { useContext, useMemo } from 'react';
import { useInfiniteQuery, QueryClientContext } from '@tanstack/react-query';
import { queryClient as defaultQueryClient } from '@/shared/api';
import { reactionAuthorsQuery } from './reactionQueries';
import type { IReactionAuthor } from './types';

interface IUseReactionAuthorsParams {
  messageId: string;
  emoji: string;
  enabled?: boolean;
}

export function useReactionAuthors({
  messageId,
  emoji,
  enabled = true,
}: IUseReactionAuthorsParams) {
  const contextClient = useContext(QueryClientContext);
  const client = contextClient ?? defaultQueryClient;

  const query = useInfiniteQuery(
    {
      ...reactionAuthorsQuery(messageId, emoji),
      enabled: Boolean(messageId && emoji && enabled),
    },
    client
  );

  const pages = query.data?.pages;

  const authors = useMemo<IReactionAuthor[]>(() => {
    if (!pages) return [];
    const list: IReactionAuthor[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      for (const user of page.users ?? []) {
        if (!seen.has(user.id)) {
          seen.add(user.id);
          list.push(user);
        }
      }
    }
    return list;
  }, [pages]);

  const total = query.data?.pages[0]?.total ?? 0;

  return {
    ...query,
    authors,
    total,
  };
}
