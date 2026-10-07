import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useComposerSendMessage } from './useComposerSendMessage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { services } from '@/services';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { clearOutbox, useOutboxStore, type IThreadPages } from '@/entities/message';
import type { IRichText } from '@/shared/lib/richText';
import type { IRichTextInputHandle } from '@/shared/ui';
import { makeMessage } from '@/test/fixtures';

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

  /** Поле ввода — редактор с «ручкой» вместо DOM-элемента (#656). */
  function fakeComposer(initial: string): IRichTextInputHandle {
    let value: IRichText = { text: initial, entities: [] };
    return {
      getValue: () => value,
      setValue: (next) => {
        value = typeof next === 'string' ? { text: next, entities: [] } : next;
      },
      focus: () => {},
      clear: () => {
        value = { text: '', entities: [] };
      },
      insertText: (text) => {
        value = { ...value, text: value.text + text };
      },
    };
  }

  function setupRefs(initialDraft = '') {
    const draftRef = { current: fakeComposer(initialDraft) };
    const attachmentInput = document.createElement('input');
    const attachmentInputRef = { current: attachmentInput };
    const bottomDiv = document.createElement('div');
    const bottomRef = { current: bottomDiv };
    const setPendingAttachments = vi.fn();

    return {
      draftRef,
      attachmentInputRef,
      bottomRef,
      setPendingAttachments,
    };
  }

  it('мгновенно добавляет оптимистичное сообщение в ленту и очищает поле ввода', async () => {
    const { draftRef, attachmentInputRef, bottomRef, setPendingAttachments } =
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
          pendingAttachments: [],
          selectionMode: false,
          setPendingAttachments,
        }),
      { wrapper: createWrapper() }
    );

    const fakeEvent = { preventDefault: vi.fn() } as any;

    await act(async () => {
      await result.current.handleSubmit(fakeEvent);
    });

    // 1. Поле ввода очищено мгновенно
    expect(draftRef.current.getValue().text).toBe('');

    // 2. Композер не заблокирован
    expect(result.current.isSending).toBe(false);

    // 3. Сообщение отправлено сервисом
    expect(services.messageService.sendMessage).toHaveBeenCalledWith(
      'chat-test-1',
      'Привет, мир!',
      'text',
      null,
      []
    );

    // 4. В кеше треда сообщение заменено на серверное
    const cached = queryClient.getQueryData<IThreadPages>(chatKeys.messages('chat-test-1'));
    expect(cached?.pages[0]?.some((m) => m.id === 'server-confirmed-1')).toBe(true);
  });

  it('при сбое сети переводит оптимистичное сообщение в failed и сохраняет в Outbox', async () => {
    const { draftRef, attachmentInputRef, bottomRef, setPendingAttachments } =
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
          pendingAttachments: [],
          selectionMode: false,
          setPendingAttachments,
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
    const { draftRef, attachmentInputRef, bottomRef, setPendingAttachments } = setupRefs('');

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
          pendingAttachments: [],
          selectionMode: false,
          setPendingAttachments,
        }),
      { wrapper: createWrapper() }
    );

    draftRef.current.setValue('Повтори меня');
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

  describe('несколько вложений (#171)', () => {
    const photo = new File(['p'], 'photo.png', { type: 'image/png' });
    const doc = new File(['d'], 'report.pdf', { type: 'application/pdf' });
    const attachments = [
      { id: 'a1', file: photo, type: 'image' as const },
      { id: 'a2', file: doc, type: 'file' as const },
    ];

    function renderSend(draft: string) {
      const refs = setupRefs(draft);
      queryClient.setQueryData(chatKeys.messages('chat-test-1'), { pages: [[]], pageParams: [0] });
      const { result } = renderHook(
        () =>
          useComposerSendMessage({
            attachmentInputRef: refs.attachmentInputRef,
            bottomRef: refs.bottomRef,
            draftRef: refs.draftRef,
            pendingAttachments: attachments,
            selectionMode: false,
            setPendingAttachments: refs.setPendingAttachments,
          }),
        { wrapper: createWrapper() }
      );
      return { ...refs, result };
    }

    it('по сообщению на файл, по порядку; подпись и ответ — у первого', async () => {
      const reply = makeMessage({ id: 'reply-1', chatId: 'chat-test-1' });
      useChatUiStore.setState({ replyToMessage: reply });
      // Второй файл уходит только после первого: порядок у собеседника тот же.
      let releaseFirst: () => void = () => {};
      const send = vi
        .spyOn(services.messageService, 'sendMediaMessage')
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = () => resolve(makeMessage({ id: 'srv-1', chatId: 'chat-test-1' }));
            })
        )
        .mockResolvedValueOnce(makeMessage({ id: 'srv-2', chatId: 'chat-test-1' }));

      const { result, setPendingAttachments, draftRef } = renderSend('Смотри');
      await act(async () => {
        await result.current.handleSubmit({ preventDefault: vi.fn() } as any);
      });

      // Композер очищен сразу, в ленте — два сообщения по порядку.
      expect(setPendingAttachments).toHaveBeenCalledWith([]);
      expect(draftRef.current.getValue().text).toBe('');
      const optimistic = queryClient.getQueryData<IThreadPages>(chatKeys.messages('chat-test-1'));
      expect(optimistic?.pages[0]?.map((m) => m.type)).toEqual(['image', 'file']);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenNthCalledWith(
        1,
        'chat-test-1',
        photo,
        'image',
        'Смотри',
        'reply-1',
        [],
        undefined
      );

      await act(async () => releaseFirst());
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenNthCalledWith(2, 'chat-test-1', doc, 'file', '', null, [], undefined);
      await waitFor(() => expect(useOutboxStore.getState().items).toHaveLength(0));
    });

    it('сбой одного не останавливает остальные: он ждёт повтора в очереди', async () => {
      vi.spyOn(services.messageService, 'sendMediaMessage')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(makeMessage({ id: 'srv-2', chatId: 'chat-test-1' }));

      const { result } = renderSend('');
      await act(async () => {
        await result.current.handleSubmit({ preventDefault: vi.fn() } as any);
      });

      await waitFor(() => {
        const items = useOutboxStore.getState().items;
        expect(items).toHaveLength(1);
        expect(items[0]?.file).toBe(photo);
        expect(items[0]?.status).toBe('failed');
      });
      expect(services.messageService.sendMediaMessage).toHaveBeenCalledTimes(2);
    });
  });
});
