import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { flattenThread, type IThreadPages } from '@/queries/chat/threadCache';
import { chatKeys } from '@/queries/keys';
import { makeMessage } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { resyncAfterReconnect } from './resyncAfterReconnect';

const CHAT_ID = 'chat-1';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Открытый чат — тот, у чьей истории есть наблюдатель. */
function openThread(queryClient: QueryClient, pages: IThreadPages['pages']) {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(CHAT_ID), {
    pages,
    pageParams: pages.map((_, index) => index * 50),
  });

  // Наблюдатель делает запрос активным — именно так восстановление
  // отличает открытый чат от закрытого. Своих запросов он не шлёт:
  // данные уже положены выше, и они не устаревают.
  const observer = new QueryObserver(queryClient, {
    queryKey: chatKeys.messages(CHAT_ID),
    queryFn: () => ({ pages: pages, pageParams: [0] }),
    staleTime: Infinity,
  });

  return observer.subscribe(() => {});
}

describe('восстановление после обрыва связи', () => {
  it('should pull messages that arrived while the connection was down', async () => {
    // Пока связи не было, собеседник написал. Без этого сообщение не
    // появилось бы в ленте никогда: история помечена как никогда не
    // устаревающая, и её никто не перезапрашивает.
    const было = makeMessage({ id: 'm-1', chatId: CHAT_ID, content: 'до обрыва' });
    const пропущенное = makeMessage({ id: 'm-2', chatId: CHAT_ID, content: 'во время обрыва' });

    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () =>
        HttpResponse.json({ messages: [было, пропущенное] })
      )
    );

    const queryClient = makeClient();
    const unsubscribe = openThread(queryClient, [[было]]);

    await resyncAfterReconnect(queryClient);

    const лента = flattenThread(queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID)));
    expect(лента.map((m) => m.id)).toEqual(['m-1', 'm-2']);

    unsubscribe();
  });

  it('should keep the history the user scrolled up to', async () => {
    // Прокрученные страницы не перезапрашиваются: это десятки запросов и
    // полная перерасшифровка ради сообщений, которые не менялись.
    const старое = makeMessage({ id: 'm-old', chatId: CHAT_ID });
    const свежее = makeMessage({ id: 'm-new', chatId: CHAT_ID });

    let запросов = 0;
    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () => {
        запросов += 1;
        return HttpResponse.json({ messages: [свежее] });
      })
    );

    const queryClient = makeClient();
    const unsubscribe = openThread(queryClient, [[свежее], [старое]]);

    await resyncAfterReconnect(queryClient);

    const лента = flattenThread(queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID)));
    expect(лента.map((m) => m.id)).toContain('m-old');
    expect(запросов).toBe(1);

    unsubscribe();
  });

  it('should leave closed chats alone', async () => {
    // У закрытого чата наблюдателей нет: тянуть его историю незачем.
    const queryClient = makeClient();
    let запросов = 0;
    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () => {
        запросов += 1;
        return HttpResponse.json({ messages: [] });
      })
    );

    queryClient.setQueryData<IThreadPages>(chatKeys.messages(CHAT_ID), {
      pages: [[makeMessage({ id: 'm-1' })]],
      pageParams: [0],
    });

    await resyncAfterReconnect(queryClient);

    expect(запросов).toBe(0);
  });

  it('should mark the chat list as stale', async () => {
    // За время обрыва могли измениться и другие чаты: их превью, порядок,
    // счётчики непрочитанных.
    const queryClient = makeClient();
    const invalidated: unknown[] = [];
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters: any) => {
      invalidated.push(filters?.queryKey);
      return Promise.resolve();
    });

    await resyncAfterReconnect(queryClient);

    expect(invalidated).toContainEqual(chatKeys.list());
  });
});
