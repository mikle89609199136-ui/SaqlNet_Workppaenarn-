import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import type { IThreadPages } from '@/entities/message/model/threadCache';
import { useMessageActions } from './useMessageActions';

afterEach(() => vi.restoreAllMocks());

describe('желаемое состояние реакции', () => {
  function setup() {
    const message = makeMessage({
      chatId: 'chat-566',
      reactions: [{ emoji: '👍', count: 1, myReaction: true }],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(chatKeys.detail('chat-566'), makeChat({ id: 'chat-566' }));
    client.setQueryData(chatKeys.messages('chat-566'), { pages: [[message]], pageParams: [0] });
    useChatUiStore.getState().resetChatState();
    useProfileStore.setState({ user: makeUser({ isPremium: true }) });
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={testI18n}>
            <MemoryRouter initialEntries={['/chat/chat-566']}>
              <Routes>
                <Route path="/chat/:chatId" element={children} />
              </Routes>
            </MemoryRouter>
          </I18nextProvider>
        </QueryClientProvider>
      );
    }
    const hook = renderHook(() => useMessageActions({ setIsForwardModalOpen: vi.fn() }), {
      wrapper,
    });
    const reactions = () =>
      client.getQueryData<IThreadPages>(chatKeys.messages('chat-566'))!.pages[0][0].reactions;
    return { message, hook, reactions };
  }

  it('заменяет реакцию одним запросом, в том числе для premium', async () => {
    const { message, hook, reactions } = setup();
    let finish!: (value: { reactions: typeof message.reactions }) => void;
    const request = vi.spyOn(services.messageService, 'reactToMessage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.handleReact(message, '❤️');
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(message.id, '❤️');
    expect(reactions()).toEqual([{ emoji: '❤️', count: 1, myReaction: true }]);
    await act(async () => {
      finish({ reactions: [{ emoji: '❤️', count: 2, myReaction: true }] });
      await pending;
    });
    expect(reactions()).toEqual([{ emoji: '❤️', count: 2, myReaction: true }]);
  });

  it('отправляет null для снятия выбранной реакции', async () => {
    const { message, hook, reactions } = setup();
    const request = vi
      .spyOn(services.messageService, 'reactToMessage')
      .mockResolvedValue({ reactions: [] });
    await act(async () => {
      await hook.result.current.handleReact(message, '👍');
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(message.id, null);
    expect(reactions()).toEqual([]);
  });

  it('откатывает оптимистическую замену при ошибке', async () => {
    const { message, hook, reactions } = setup();
    vi.spyOn(services.messageService, 'reactToMessage').mockRejectedValue(new Error('offline'));
    await act(async () => {
      await hook.result.current.handleReact(message, '❤️');
    });
    expect(reactions()).toEqual(message.reactions);
    expect(useChatUiStore.getState().error).toBeTruthy();
  });
});
