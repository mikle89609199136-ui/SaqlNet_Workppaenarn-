import { searchUsersQuery, MIN_SEARCH_LENGTH } from '@/queries/users/searchUsersQuery';
import type { IChatDto, ISearchUserDto } from '@/types';
import { getLastMessageText } from '@/shared/lib';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebounce } from '@/shared/lib/useDebounce';

interface Result {
  query: string;
  setQuery: (value: string) => void;
  reset: () => void;
  /** Идёт ли поиск: панель показывает результаты вместо списка чатов. */
  isSearching: boolean;
  chats: IChatDto[];
  people: ISearchUserDto[];
  isLoadingPeople: boolean;
  /** Запрос введён, но ничего не нашлось ни там, ни там. */
  isEmpty: boolean;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Поиск по списку чатов.
 *
 * Свои чаты фильтруются на месте и без задержки: они целиком лежат в кеше
 * запросов, ходить за ними некуда. Люди приходят с сервера, поэтому для
 * них запрос откладывается — иначе каждая буква превращалась бы в
 * обращение к сети.
 *
 * Найденные люди, с которыми чат уже есть, из своего раздела убираются:
 * они показаны выше, среди чатов, и вторая строка про того же человека
 * читается как две разные записи.
 */
export function useChatsSearch(allChats: IChatDto[]): Result {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const isSearching = query.trim().length > 0;

  const chats = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return [];

    return allChats.filter((chat) => {
      const title = normalize(chat.title || '');
      const lastMessage = normalize(getLastMessageText(chat.lastMessage, t) || '');
      return title.includes(needle) || lastMessage.includes(needle);
    });
  }, [allChats, query, t]);

  const { data: foundPeople = [], isFetching } = useQuery(searchUsersQuery(debouncedQuery));

  const people = useMemo(() => {
    const peerIds = new Set(allChats.map((chat) => chat.peerId).filter(Boolean));
    return foundPeople.filter((user) => !peerIds.has(user.id));
  }, [allChats, foundPeople]);

  const isTooShort = normalize(query).replace(/^@/, '').length < MIN_SEARCH_LENGTH;
  const isLoadingPeople = isSearching && !isTooShort && isFetching;

  return {
    query,
    setQuery,
    reset: () => setQuery(''),
    isSearching,
    chats,
    people,
    isLoadingPeople,
    isEmpty: isSearching && !isLoadingPeople && chats.length === 0 && people.length === 0,
  };
}
