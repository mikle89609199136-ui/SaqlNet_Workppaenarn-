import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useComposerSendMessage } from './useComposerSendMessage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { services } from '@/services';
import { useChatUiStore, useProfileStore } from '@/store';
import { clearOutbox, getChatOutbox, useOutboxStore } from '@/store/outbox';
import { chatKeys } from '@/queries/keys';
import { makeMessage } from '@/test/fixtures';
import type { IThreadPages } from '@/queries/chat/threadCache';

import { MemoryRouter, Route, Routes } from 'react-router-dom';

describe('useComposerSendMessage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clearOutbox();
    useChatUiStore.setState({
      editingMessage: null,
      replyToMessage: null,
      error: '',
    });
    useProfileStore.setState({
      user: { id: 'user-me', username: 'tester' } as any,
    });
    vi.restoreAllMocks();
  });

  function createWrapper() {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/chats/chat-test-1']}>
          <Routes>
            <Route path="/chats/:chatId" element={<>{children}</>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  function setupRefs(initialDraft = '') {
    const input = document.createElement('input');
    input.value = initialDraft;
    const draftRef = { current: input };
    const attachmentInput = document.createElement('input');
    const attachmentInputRef = { current: attachmentInput };
    const bottomDiv = document.createElement('div');
    const bottomRef = { current: bottomDiv };
    const setPendingAttachment = vi.fn();

    return {
      draftRef,
      attachmentInputRef,
      bottomRef,
      setPendingAttachment,
    };
  }

  it('мгновенно добавляет оптимистичное сообщение в ленту и очищает поле ввода', async () => {
    const { draftRef, attachmentInputRef, bottomRef, setPendingAttachment } =
      setupRefs('Привет, мир!');

    // Предзаполняем кеш треда
    const initialPages: IThreadPages = {
      pages: [[]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages('chat-test-1'), initialPages);

    const serverMessage = makeMessage({
      id: 'server-confirmed-1',
      chatId: 'chat-test-1',
      content: 'Привет, мир!',
    });
    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    const { result } = renderHook(
      () =>
        useComposerSendMessage({
          attachmentInputRef,
          bottomRef,
          draftRef,
          pendingAttachment: null,
          selectionMode: false,
          setPendingAttachment,
        }),
      { wrapper: createWrapper() }
    );

    const fakeEvent = { preventDefault: vi.fn() } as any;

    await act(async () => {
      await result.current.handleSubmit(fakeEvent);
    });

    // 1. Поле ввода очищено мгновенно
    expect(draftRef.current.value).toBe('');

    // 2. Композер не заблокирован
    expect(result.current.isSending).toBe(false);

    // 3. Сообщение отправлено сервисом
    expect(services.messageService.sendMessage).toHaveBeenCalledWith(
      'chat-test-1',
      'Привет, мир!',
      'text',
      null
    );

    // 4. В кеше треда сообщение заменено на серверное
    const cached = queryClient.getQueryData<IThreadPages>(chatKeys.messages('chat-test-1'));
    expect(cached?.pages[0]?.some((m) => m.id === 'server-confirmed-1')).toBe(true);
  });

  it('при сбое сети переводит оптимистичное сообщение в failed и сохраняет в Outbox', async () => {
    const { draftRef, attachmentInputRef, bottomRef, setPendingAttachment } =
      setupRefs('Текст с ошибкой');

    const initialPages: IThreadPages = {
      pages: [[]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages('chat-test-1'), initialPages);

    vi.spyOn(services.messageService, 'sendMessage').mockRejectedValue(
      new Error('Network offline')
    );

    const { result } = renderHook(
      () =>
        useComposerSendMessage({
          attachmentInputRef,
          bottomRef,
          draftRef,
          pendingAttachment: null,
          selectionMode: false,
          setPendingAttachment,
        }),
      { wrapper: createWrapper() }
    );

    const fakeEvent = { preventDefault: vi.fn() } as any;

    await act(async () => {
      await result.current.handleSubmit(fakeEvent);
    });

    // Сообщение сохранено в Outbox со статусом failed после завершения промиса
    await waitFor(() => {
      const outboxItems = useOutboxStore.getState().items;
      expect(outboxItems).toHaveLength(1);
      expect(outboxItems[0]?.status).toBe('failed');
      expect(outboxItems[0]?.content).toBe('Текст с ошибкой');
    });

    // В кеше треда баббл помечен failed
    const cached = queryClient.getQueryData<IThreadPages>(chatKeys.messages('chat-test-1'));
    expect(cached?.pages[0]?.[0]?.status).toBe('failed');
  });

  it('позволяет повторить отправку failed сообщения через handleRetryMessage', async () => {
    const { draftRef, attachmentInputRef, bottomRef, setPendingAttachment } = setupRefs('');

    const initialPages: IThreadPages = {
      pages: [[]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages('chat-test-1'), initialPages);

    // Сначала фейлим
    vi.spyOn(services.messageService, 'sendMessage').mockRejectedValueOnce(new Error('Fail 1'));

    const { result } = renderHook(
      () =>
        useComposerSendMessage({
          attachmentInputRef,
          bottomRef,
          draftRef,
          pendingAttachment: null,
          selectionMode: false,
          setPendingAttachment,
        }),
      { wrapper: createWrapper() }
    );

    draftRef.current.value = 'Повтори меня';
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: vi.fn() } as any);
    });

    await waitFor(() => {
      const failed = useOutboxStore.getState().items[0];
      expect(failed?.status).toBe('failed');
    });

    const failedItem = useOutboxStore.getState().items[0]!;

    // Теперь сервер готов принять
    const serverMessage = makeMessage({
      id: 'server-ok',
      chatId: 'chat-test-1',
      content: 'Повтори меня',
    });
    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    // Вызываем повтор
    await act(async () => {
      result.current.handleRetryMessage({
        id: failedItem.tempId,
        tempId: failedItem.tempId,
      } as any);
    });

    // Outbox очищен
    await waitFor(() => {
      expect(useOutboxStore.getState().items).toHaveLength(0);
    });

    // В кеше серверное сообщение
    const cached = queryClient.getQueryData<IThreadPages>(chatKeys.messages('chat-test-1'));
    expect(cached?.pages[0]?.some((m) => m.id === 'server-ok')).toBe(true);
  });
});
