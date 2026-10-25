import { makeChat } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { MAX_PINNED_CHATS, useChatActions } from './useChatActions';
import { clearToasts, getToasts } from '@/shared/ui';
import { chatKeys } from '@/entities/chat';
import type { IChatDto } from '@/types';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

/** Тот же провайдер, но с клиентом наружу: тесту нужно смотреть в кеш. */
function wrapperWith(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    );
  };
}

/** Непрочитанных в списке — то, что видит человек на бейдже. */
function unreadInList(queryClient: QueryClient): number | undefined {
  return queryClient.getQueryData<IChatDto[]>(chatKeys.list())?.[0]?.unreadCount;
}

describe('действия над чатом', () => {
  it('закрепляет незакреплённый', async () => {
    let method = '';
    server.use(
      http.post(api('/chats/:chatId/pin'), () => {
        method = 'POST';
        return HttpResponse.json({});
      })
    );

    const { result } = renderHook(() => useChatActions(), { wrapper });
    act(() => result.current.togglePin(makeChat({ isPinned: false }), 0));

    await waitFor(() => expect(method).toBe('POST'));
  });

  it('открепляет закреплённый тем же пунктом', async () => {
    let method = '';
    server.use(
      http.delete(api('/chats/:chatId/pin'), () => {
        method = 'DELETE';
        return HttpResponse.json({});
      })
    );

    const { result } = renderHook(() => useChatActions(), { wrapper });
    act(() => result.current.togglePin(makeChat({ isPinned: true }), 5));

    await waitFor(() => expect(method).toBe('DELETE'));
  });

  it('не даёт закрепить сверх предела и говорит об этом', async () => {
    /* Ограничение придумано не сервером: он берёт любое количество.
       Смысл в том, что двадцать закреплённых — это уже не закрепление. */
    let called = false;
    server.use(
      http.post(api('/chats/:chatId/pin'), () => {
        called = true;
        return HttpResponse.json({});
      })
    );

    const { result } = renderHook(() => useChatActions(), { wrapper });
    act(() => result.current.togglePin(makeChat({ isPinned: false }), MAX_PINNED_CHATS));

    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0));
    expect(called).toBe(false);
  });

  it('убирает в архив и возвращает обратно', async () => {
    const calls: string[] = [];
    server.use(
      http.post(api('/chats/:chatId/archive'), () => {
        calls.push('POST');
        return HttpResponse.json({});
      }),
      http.delete(api('/chats/:chatId/archive'), () => {
        calls.push('DELETE');
        return HttpResponse.json({});
      })
    );

    const { result } = renderHook(() => useChatActions(), { wrapper });

    act(() => result.current.toggleArchive(makeChat({ isArchived: false })));
    await waitFor(() => expect(calls).toContain('POST'));

    act(() => result.current.toggleArchive(makeChat({ isArchived: true })));
    await waitFor(() => expect(calls).toContain('DELETE'));
  });
});

describe('отметка чата прочитанным', () => {
  it('гасит счётчик сразу, не дожидаясь сервера', async () => {
    /* Иначе бейдж мигает прежним числом до конца запроса, а на медленной
       связи это видно глазом. */
    let answerServer: (() => void) | undefined;
    const holdRequest = new Promise<void>((resolve) => {
      answerServer = resolve;
    });

    server.use(
      http.post(api('/chats/:chatId/read'), async () => {
        await holdRequest;
        return HttpResponse.json({});
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chat = makeChat({ unreadCount: 3 });
    queryClient.setQueryData(chatKeys.list(), [chat]);

    const { result } = renderHook(() => useChatActions(), { wrapper: wrapperWith(queryClient) });
    act(() => result.current.markRead(chat));

    await waitFor(() => expect(unreadInList(queryClient)).toBe(0));

    answerServer?.();
  });

  it('возвращает счётчик, если сервер отказал', async () => {
    clearToasts();
    server.use(
      http.post(api('/chats/:chatId/read'), () =>
        HttpResponse.json({ code: 'access_denied', error: 'nope' }, { status: 403 })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chat = makeChat({ unreadCount: 3 });
    queryClient.setQueryData(chatKeys.list(), [chat]);

    const { result } = renderHook(() => useChatActions(), { wrapper: wrapperWith(queryClient) });
    act(() => result.current.markRead(chat));

    // Отказ виден человеку…
    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0));
    // …и счётчик возвращается: непрочитанные никуда не делись.
    expect(unreadInList(queryClient)).toBe(3);
  });
});

describe('personal mute #725', () => {
  it.each([false, true])(
    'сохраняет toggle mute=%s и обновляет list/archive/detail',
    async (muted) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const chat = makeChat({ isMuted: muted, unreadCount: 3 });
      client.setQueryData(chatKeys.list(), [chat]);
      client.setQueryData(chatKeys.archived(), [chat]);
      client.setQueryData(chatKeys.detail(chat.id), chat);
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let sent: unknown;
      server.use(
        http.post(api('/chats/:chatId/mute'), async ({ request }) => {
          sent = await request.json();
          await gate;
          return HttpResponse.json({ success: true });
        }),
        http.delete(api('/chats/:chatId/mute'), async () => {
          sent = 'DELETE';
          await gate;
          return HttpResponse.json({ success: true });
        })
      );
      const { result } = renderHook(() => useChatActions(), { wrapper: wrapperWith(client) });
      act(() => result.current.toggleMute(chat));
      await waitFor(() =>
        expect(client.getQueryData<IChatDto>(chatKeys.detail(chat.id))?.isMuted).toBe(!muted)
      );
      expect(client.getQueryData<IChatDto[]>(chatKeys.list())?.[0]).toMatchObject({
        isMuted: !muted,
        unreadCount: 3,
      });
      expect(client.getQueryData<IChatDto[]>(chatKeys.archived())?.[0].isMuted).toBe(!muted);
      await waitFor(() => expect(sent).toEqual(muted ? 'DELETE' : {}));
      await act(async () => finish());
      await waitFor(() => expect(result.current.isMutePending).toBe(false));
    }
  );

  it('при ошибке возвращает mute, сохраняя новые unread и соседние поля', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const chat = makeChat({ isMuted: false, unreadCount: 3 });
    client.setQueryData(chatKeys.list(), [chat]);
    client.setQueryData(chatKeys.detail(chat.id), chat);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      http.post(api('/chats/:chatId/mute'), async () => {
        await gate;
        return HttpResponse.json({}, { status: 500 });
      })
    );
    const { result } = renderHook(() => useChatActions(), { wrapper: wrapperWith(client) });
    act(() => result.current.toggleMute(chat));
    await waitFor(() =>
      expect(client.getQueryData<IChatDto>(chatKeys.detail(chat.id))?.isMuted).toBe(true)
    );
    client.setQueryData(chatKeys.list(), [
      { ...chat, isMuted: true, unreadCount: 9, hideNotificationPreview: true },
    ]);
    await act(async () => finish());
    await waitFor(() => expect(result.current.isMutePending).toBe(false));
    expect(client.getQueryData<IChatDto[]>(chatKeys.list())?.[0]).toMatchObject({
      isMuted: false,
      unreadCount: 9,
      hideNotificationPreview: true,
    });
    expect(client.getQueryData<IChatDto>(chatKeys.detail(chat.id))?.isMuted).toBe(false);
  });
});
