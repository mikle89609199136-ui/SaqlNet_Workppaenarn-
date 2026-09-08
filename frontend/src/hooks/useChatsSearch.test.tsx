import { testI18n } from '@/test/harness/i18n';
import { makeChat } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { useChatsSearch } from './useChatsSearch';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

const chats = [
  makeChat({ id: 'chat-1', title: 'Максим', peerId: 'user-2' }),
  makeChat({ id: 'chat-2', title: 'Рабочая группа', type: 'group' }),
];

describe('поиск по списку чатов', () => {
  it('молчит, пока ничего не введено', () => {
    const { result } = renderHook(() => useChatsSearch(chats), { wrapper });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.chats).toHaveLength(0);
  });

  it('находит чат по названию, не дожидаясь сервера', () => {
    const { result } = renderHook(() => useChatsSearch(chats), { wrapper });

    act(() => result.current.setQuery('рабоч'));

    expect(result.current.chats.map((chat) => chat.id)).toEqual(['chat-2']);
  });

  it('не разбирает регистр', () => {
    const { result } = renderHook(() => useChatsSearch(chats), { wrapper });

    act(() => result.current.setQuery('МАКСИМ'));

    expect(result.current.chats.map((chat) => chat.id)).toEqual(['chat-1']);
  });

  it('прячет из людей тех, с кем переписка уже есть', async () => {
    server.use(
      http.get(api('/users/search'), () =>
        HttpResponse.json({
          users: [
            { id: 'user-2', username: 'maxim', firstName: 'Максим', lastName: '', avatarUrl: '' },
            { id: 'user-9', username: 'maximus', firstName: 'Максим', lastName: '', avatarUrl: '' },
          ],
        })
      )
    );

    const { result } = renderHook(() => useChatsSearch(chats), { wrapper });
    act(() => result.current.setQuery('максим'));

    await waitFor(() => expect(result.current.people).toHaveLength(1));
    expect(result.current.people[0].id).toBe('user-9');
  });

  it('сообщает, что не нашлось ничего', async () => {
    server.use(http.get(api('/users/search'), () => HttpResponse.json({ users: [] })));

    const { result } = renderHook(() => useChatsSearch(chats), { wrapper });
    act(() => result.current.setQuery('щщщ'));

    await waitFor(() => expect(result.current.isEmpty).toBe(true));
  });

  it('сбрасывает поиск', () => {
    const { result } = renderHook(() => useChatsSearch(chats), { wrapper });

    act(() => result.current.setQuery('максим'));
    act(() => result.current.reset());

    expect(result.current.isSearching).toBe(false);
  });
});
