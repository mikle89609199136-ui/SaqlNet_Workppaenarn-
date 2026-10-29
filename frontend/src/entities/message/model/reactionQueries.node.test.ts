import { describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import {
  reactionAuthorsQuery,
  reactionAuthorsSummaryQuery,
  REACTION_AUTHORS_PAGE_SIZE,
} from './reactionQueries';

describe('reactionAuthorsQuery', () => {
  it('формирует корректный queryKey и initialPageParam', () => {
    const query = reactionAuthorsQuery('msg-42', '🔥');
    expect(query.queryKey).toEqual(['message', 'msg-42', 'reactions', 'users', '🔥']);
    expect(query.initialPageParam).toBe('');
    expect(query.staleTime).toBe(30_000);
  });

  it('извлекает nextCursor в getNextPageParam', () => {
    const query = reactionAuthorsQuery('msg-42', '🔥');
    const getNextPageParam = query.getNextPageParam!;

    expect(
      getNextPageParam(
        { emoji: '🔥', total: 5, users: [], nextCursor: 'cur-next' },
        [],
        undefined,
        []
      )
    ).toBe('cur-next');

    expect(
      getNextPageParam({ emoji: '🔥', total: 5, users: [] }, [], undefined, [])
    ).toBeUndefined();
  });

  it('вызывает services.messageService.listReactionAuthors в queryFn', async () => {
    const listSpy = vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValueOnce({
      emoji: '🔥',
      total: 1,
      users: [{ id: 'u-1', firstName: 'Алексей', lastName: 'Иванов', username: 'alex' }],
      nextCursor: undefined,
    });

    const query = reactionAuthorsQuery('msg-42', '🔥');
    const result = await (query.queryFn as any)({ pageParam: 'cur-1' });

    expect(listSpy).toHaveBeenCalledWith('msg-42', '🔥', 'cur-1', REACTION_AUTHORS_PAGE_SIZE);
    expect(result.total).toBe(1);
    expect(result.users[0].firstName).toBe('Алексей');

    listSpy.mockRestore();
  });

  it('reactionAuthorsSummaryQuery формирует queryKey со сводным префиксом', async () => {
    const listSpy = vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValueOnce({
      emoji: '👍',
      total: 1,
      users: [{ id: 'u-2', firstName: 'Мария', lastName: 'Петрова', username: 'maria' }],
      nextCursor: undefined,
    });

    const query = reactionAuthorsSummaryQuery('msg-42', '👍');
    expect(query.queryKey).toEqual(['message', 'msg-42', 'reactions', 'users', 'summary', '👍']);
    const result = await (query.queryFn as any)();

    expect(listSpy).toHaveBeenCalledWith('msg-42', '👍', undefined, REACTION_AUTHORS_PAGE_SIZE);
    expect(result.total).toBe(1);
    expect(result.users[0].firstName).toBe('Мария');

    listSpy.mockRestore();
  });
});
