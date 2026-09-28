import { chatsQuery } from '@/entities/chat';
import { services } from '@/services';
import { useDebounce } from '@/shared/lib';
import type { ISearchUserDto } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { suggestedMembers } from './suggestedMembers';

/** С какой длины запроса искать на сервере: одна буква находит всех. */
const SEARCH_FROM = 2;

/**
 * Кого предложить в группу (#822): пока запрос короткий — собеседники из
 * недавних личных переписок, дальше — поиск по имени и нику. Себя и тех,
 * кто уже в группе, в списке нет.
 */
export function usePeopleSearch(search: string, meId: string | undefined, excludeIds: string[]) {
  const { data: chats = [] } = useQuery(chatsQuery());
  const query = useDebounce(search);
  const [foundFor, setFoundFor] = useState<{ query: string; users: ISearchUserDto[] }>({
    query: '',
    users: [],
  });

  useEffect(() => {
    if (query.trim().length < SEARCH_FROM) return undefined;

    let cancelled = false;
    services.chatService
      .searchUsers(query)
      .then((users) => {
        if (!cancelled) setFoundFor({ query, users });
      })
      .catch(() => {
        if (!cancelled) setFoundFor({ query, users: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const isSearching = query.trim().length >= SEARCH_FROM;
  const suggestions = useMemo(() => suggestedMembers(chats, meId), [chats, meId]);
  const excluded = useMemo(() => new Set([...excludeIds, meId ?? '']), [excludeIds, meId]);

  const source = isSearching ? (foundFor.query === query ? foundFor.users : []) : suggestions;
  const people = source.filter((user) => !excluded.has(user.id));

  return {
    people,
    isSearching,
    // Ответ по нынешнему запросу ещё не пришёл.
    isLoading: isSearching && foundFor.query !== query,
  };
}
