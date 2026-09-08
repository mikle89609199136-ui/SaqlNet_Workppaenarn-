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
import { useToastStore } from '@/store/toast';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
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

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
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
