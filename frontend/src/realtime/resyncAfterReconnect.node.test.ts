import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  dropThreadMessages,
  flattenThread,
  patchThreadMessage,
  putThreadMessage,
  putThreadReceipt,
  type IThreadPages,
} from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { chatKeys } from '@/entities/chat';
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
    const before = makeMessage({ id: 'm-1', chatId: CHAT_ID, content: 'до обрыва' });
    const missed = makeMessage({ id: 'm-2', chatId: CHAT_ID, content: 'во время обрыва' });

    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () => HttpResponse.json({ messages: [before, missed] }))
    );

    const queryClient = makeClient();
    const unsubscribe = openThread(queryClient, [[before]]);

    await resyncAfterReconnect(queryClient);

    const thread = flattenThread(
      queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID))
    );
    expect(thread.map((m) => m.id)).toEqual(['m-1', 'm-2']);

    unsubscribe();
  });

  it('refreshes existing messages and replaces decryption placeholders without duplicating history', async () => {
    const older = makeMessage({ id: 'm-old', chatId: CHAT_ID, content: 'older page' });
    const before = makeMessage({ id: 'm-edit', chatId: CHAT_ID, content: 'old text' });
    const locked = {
      ...makeMessage({ id: 'm-locked', chatId: CHAT_ID, content: '🔒' }),
      undecryptable: 'keyUnavailable' as const,
    };
    const edited = { ...before, content: 'edited offline', isEdited: true };
    const unlocked = { ...locked, content: 'decrypted', undecryptable: undefined };
    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () =>
        HttpResponse.json({ messages: [edited, unlocked] })
      )
    );
    const queryClient = makeClient();
    // A known message can live on an older cached page after new arrivals.
    const unsubscribe = openThread(queryClient, [[locked], [before, older]]);
    try {
      await resyncAfterReconnect(queryClient);
      await resyncAfterReconnect(queryClient);
      const data = queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID))!;
      const thread = flattenThread(data);
      expect(thread).toHaveLength(3);
      expect(thread.find((m) => m.id === before.id)).toMatchObject({
        content: 'edited offline',
        isEdited: true,
      });
      expect(thread.find((m) => m.id === locked.id)).toMatchObject({
        content: 'decrypted',
        undecryptable: undefined,
      });
      expect(thread.find((m) => m.id === older.id)).toEqual(older);
      expect(data.pageParams).toEqual([0, 50]);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  it.each(['added', 'removed'] as const)(
    'preserves %s reactions, receipts, pins and deletions received during a reconnect request',
    async (change) => {
      const before = makeMessage({
        id: 'm-race',
        chatId: CHAT_ID,
        senderId: 'owner',
        content: 'old text',
        reactions: [],
        createdAt: new Date('2026-10-16T10:00:00Z'),
        updatedAt: new Date('2026-10-16T10:00:00Z'),
      });
      const deleted = makeMessage({ id: 'm-deleted', chatId: CHAT_ID });
      const arrived = makeMessage({
        id: 'm-live',
        chatId: CHAT_ID,
        createdAt: new Date('2026-10-16T10:00:03Z'),
      });
      const reaction = [{ emoji: '👍', count: 1, myReaction: false }];
      // In the removal case the final reactions equal the initial cache value.
      // A field-diff-only merge would miss this authoritative realtime event.
      const reactions = change === 'added' ? reaction : [];
      const snapshot = {
        ...before,
        content: 'edited offline',
        reactions: change === 'added' ? [] : reaction,
      };
      const queryClient = makeClient();
      const unsubscribe = openThread(queryClient, [[before, deleted]]);
      let release!: (messages: (typeof before)[]) => void;
      const response = new Promise<(typeof before)[]>((resolve) => {
        release = resolve;
      });
      const fetch = vi
        .spyOn(services.messageService, 'fetchMessagesPage')
        .mockReturnValue(response);
      try {
        const syncing = resyncAfterReconnect(queryClient);
        expect(fetch).toHaveBeenCalledOnce();
        patchThreadMessage(queryClient, CHAT_ID, before.id, { reactions, isPinned: true });
        putThreadReceipt(queryClient, {
          chatId: CHAT_ID,
          userId: 'peer',
          kind: 'read',
          upTo: '2026-10-16T10:00:01Z',
          at: '2026-10-16T10:00:02Z',
        });
        dropThreadMessages(queryClient, CHAT_ID, [deleted.id]);
        putThreadMessage(queryClient, CHAT_ID, arrived);
        release([snapshot, deleted]);
        await syncing;
        const thread = flattenThread(
          queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID))
        );
        expect(thread.find((m) => m.id === before.id)).toMatchObject({
          content: 'edited offline',
          reactions,
          isPinned: true,
          readAt: '2026-10-16T10:00:02Z',
        });
        expect(thread.map((m) => m.id)).not.toContain(deleted.id);
        expect(thread.filter((m) => m.id === arrived.id)).toEqual([arrived]);
      } finally {
        unsubscribe();
        queryClient.clear();
        fetch.mockRestore();
      }
    }
  );

  it('does not replay an older edit over a newer snapshot version', async () => {
    const before = makeMessage({
      id: 'm-edit-race',
      chatId: CHAT_ID,
      content: 'before',
      updatedAt: new Date('2026-10-16T10:00:00Z'),
    });
    const latest = {
      ...before,
      content: 'latest server edit',
      updatedAt: new Date('2026-10-16T10:00:02Z'),
    };
    const queryClient = makeClient();
    const unsubscribe = openThread(queryClient, [[before]]);
    let release!: (messages: (typeof before)[]) => void;
    const response = new Promise<(typeof before)[]>((resolve) => {
      release = resolve;
    });
    const fetch = vi.spyOn(services.messageService, 'fetchMessagesPage').mockReturnValue(response);
    try {
      const syncing = resyncAfterReconnect(queryClient);
      patchThreadMessage(queryClient, CHAT_ID, before.id, {
        content: 'earlier edit',
        updatedAt: new Date('2026-10-16T10:00:01Z'),
      });
      patchThreadMessage(queryClient, CHAT_ID, before.id, { isPinned: true });
      release([latest]);
      await syncing;
      expect(
        flattenThread(queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID)))[0]
      ).toMatchObject({ content: 'latest server edit', isPinned: true });
    } finally {
      unsubscribe();
      queryClient.clear();
      fetch.mockRestore();
    }
  });

  it('should keep the history the user scrolled up to', async () => {
    // Прокрученные страницы не перезапрашиваются: это десятки запросов и
    // полная перерасшифровка ради сообщений, которые не менялись.
    const older = makeMessage({ id: 'm-old', chatId: CHAT_ID });
    const newer = makeMessage({ id: 'm-new', chatId: CHAT_ID });

    let requests = 0;
    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () => {
        requests += 1;
        return HttpResponse.json({ messages: [newer] });
      })
    );

    const queryClient = makeClient();
    const unsubscribe = openThread(queryClient, [[newer], [older]]);

    await resyncAfterReconnect(queryClient);

    const thread = flattenThread(
      queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID))
    );
    expect(thread.map((m) => m.id)).toContain('m-old');
    expect(requests).toBe(1);

    unsubscribe();
  });

  it('should leave closed chats alone', async () => {
    // У закрытого чата наблюдателей нет: тянуть его историю незачем.
    const queryClient = makeClient();
    let requests = 0;
    server.use(
      http.get(api(`/messages/${CHAT_ID}`), () => {
        requests += 1;
        return HttpResponse.json({ messages: [] });
      })
    );

    queryClient.setQueryData<IThreadPages>(chatKeys.messages(CHAT_ID), {
      pages: [[makeMessage({ id: 'm-1' })]],
      pageParams: [0],
    });

    await resyncAfterReconnect(queryClient);

    expect(requests).toBe(0);
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
