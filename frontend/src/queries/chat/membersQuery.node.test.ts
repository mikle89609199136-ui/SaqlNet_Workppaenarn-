import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { membersQuery } from './membersQuery';

const CHAT_ID = 'chat-1';

function member(role: string) {
  return { id: 'user-2', username: 'boris', role };
}

describe('участники группы', () => {
  it('should refetch after the list was invalidated', async () => {
    // Роль меняется запросом, ответ на который списка не содержит. Пока
    // участники кешировались промисом внутри сервиса, повторное открытие
    // модалки показывало прежнюю роль.
    let role = 'member';
    server.use(
      http.get(api(`/chats/${CHAT_ID}/members`), () =>
        HttpResponse.json({ members: [member(role)] })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = await queryClient.fetchQuery(membersQuery(CHAT_ID));
    expect(first[0].role).toBe('member');

    role = 'admin';
    await queryClient.invalidateQueries({ queryKey: membersQuery(CHAT_ID).queryKey });
    const second = await queryClient.fetchQuery(membersQuery(CHAT_ID));

    expect(second[0].role).toBe('admin');
  });

  it('should serve a repeated read from the cache', async () => {
    let requests = 0;
    server.use(
      http.get(api(`/chats/${CHAT_ID}/members`), () => {
        requests += 1;
        return HttpResponse.json({ members: [member('member')] });
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await queryClient.fetchQuery(membersQuery(CHAT_ID));
    await queryClient.fetchQuery(membersQuery(CHAT_ID));

    expect(requests).toBe(1);
  });
});
