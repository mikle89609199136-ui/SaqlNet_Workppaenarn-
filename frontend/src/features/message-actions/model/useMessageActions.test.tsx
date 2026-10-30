import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import * as translatorApi from '@/services/translatorApi';
import * as translatorConsent from '@/services/translatorConsent';
import { clearToasts, getToasts } from '@/shared/ui';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import type { IThreadPages } from '@/entities/message/model/threadCache';
import { useMessageActions } from './useMessageActions';

afterEach(() => {
  vi.restoreAllMocks();
  clearToasts();
});

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

  it('действие закрепления открывает диалог без запроса к API', () => {
    const { message, hook } = setup();
    const request = vi.spyOn(services.messageService, 'pinMessage');
    act(() => hook.result.current.handlePinMessage(message));
    expect(useChatUiStore.getState().pinRequest).toEqual({ targets: [message], unpin: false });
    expect(request).not.toHaveBeenCalled();
    act(() => hook.result.current.handleUnpinMessage(message));
    expect(useChatUiStore.getState().pinRequest?.unpin).toBe(true);
  });

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

describe('перевод сообщений (#1085)', () => {
  function setup() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(chatKeys.detail('chat-566'), makeChat({ id: 'chat-566' }));
    client.setQueryData(chatKeys.messages('chat-566'), { pages: [[]], pageParams: [0] });
    useChatUiStore.getState().resetChatState();
    useProfileStore.setState({ user: makeUser({ id: 'me-1' }) });
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
    return { hook };
  }

  it('запрашивает согласие перед переводом через translatorConsentRequest без window.confirm', async () => {
    const { hook } = setup();
    const msg1 = makeMessage({ id: 'm1', senderId: 'peer-1', content: 'Good morning' });
    vi.spyOn(translatorConsent, 'hasTranslatorConsent').mockReturnValue(false);
    const confirmSpy = vi.spyOn(window, 'confirm');

    act(() => {
      useChatUiStore.setState({
        selectedMessages: [msg1],
        selectionMode: true,
      });
    });

    await act(async () => {
      await hook.result.current.handleTranslateMessage();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    // Запрос согласия выставлен в store для диалога, выбор не сброшен
    expect(useChatUiStore.getState().translatorConsentRequest).toEqual({ targets: [msg1] });
    expect(useChatUiStore.getState().selectionMode).toBe(true);
    expect(useChatUiStore.getState().selectedMessages).toHaveLength(1);
  });

  it('при наличии согласия переводит выбранные сообщения и сбрасывает выбор', async () => {
    const { hook } = setup();
    const msg1 = makeMessage({ id: 'm1', senderId: 'peer-1', content: 'Good morning' });
    const msg2 = makeMessage({ id: 'm2', senderId: 'peer-1', content: 'Good evening' });
    const callMsg = makeMessage({ id: 'call-1', type: 'call', content: '{}' });

    vi.spyOn(translatorConsent, 'hasTranslatorConsent').mockReturnValue(true);

    act(() => {
      useChatUiStore.setState({
        selectedMessages: [msg1, callMsg, msg2],
        selectionMode: true,
      });
    });

    const translateSpy = vi
      .spyOn(translatorApi, 'translateText')
      .mockImplementation(async (text) => {
        if (text === 'Good morning') {
          return { translatedText: 'Доброе утро', targetLanguage: 'ru', detectedSourceLang: 'en' };
        }
        return { translatedText: 'Добрый вечер', targetLanguage: 'ru', detectedSourceLang: 'en' };
      });

    await act(async () => {
      await hook.result.current.handleTranslateMessage();
    });

    expect(translateSpy).toHaveBeenCalledTimes(2);
    expect(useChatUiStore.getState().translations).toEqual({
      m1: 'Доброе утро',
      m2: 'Добрый вечер',
    });
    expect(useChatUiStore.getState().selectionMode).toBe(false);
    expect(useChatUiStore.getState().selectedMessages).toEqual([]);
    expect(useChatUiStore.getState().translatorConsentRequest).toBeNull();
  });

  it('confirmTranslate выполняет перевод переданных сообщений и сбрасывает выбор', async () => {
    const { hook } = setup();
    const msg1 = makeMessage({ id: 'm1', senderId: 'peer-1', content: 'Good morning' });

    act(() => {
      useChatUiStore.setState({
        selectedMessages: [msg1],
        selectionMode: true,
      });
    });

    vi.spyOn(translatorApi, 'translateText').mockResolvedValue({
      translatedText: 'Доброе утро',
      targetLanguage: 'ru',
      detectedSourceLang: 'en',
    });

    await act(async () => {
      await hook.result.current.confirmTranslate([msg1]);
    });

    expect(useChatUiStore.getState().translations['m1']).toBe('Доброе утро');
    expect(useChatUiStore.getState().selectionMode).toBe(false);
  });

  it('одиночное сообщение: переводит при наличии согласия и отменяет при повторном вызове', async () => {
    const { hook } = setup();
    const msg = makeMessage({ id: 'msg-trans-1', senderId: 'peer-1', content: 'Hello' });
    vi.spyOn(translatorConsent, 'hasTranslatorConsent').mockReturnValue(true);
    vi.spyOn(translatorApi, 'translateText').mockResolvedValue({
      translatedText: 'Привет',
      targetLanguage: 'ru',
      detectedSourceLang: 'en',
    });

    await act(async () => {
      await hook.result.current.handleTranslateMessage(msg);
    });

    expect(useChatUiStore.getState().translations['msg-trans-1']).toBe('Привет');

    // Повторный вызов убирает перевод
    await act(async () => {
      await hook.result.current.handleTranslateMessage(msg);
    });

    expect(useChatUiStore.getState().translations['msg-trans-1']).toBeUndefined();
  });

  it('пакетный перевод: при частичной ошибке показывает тост предупреждения', async () => {
    const { hook } = setup();
    const msg1 = makeMessage({ id: 'm1', senderId: 'peer-1', content: 'Good morning' });
    const msg2 = makeMessage({ id: 'm2', senderId: 'peer-1', content: 'Fail me' });

    vi.spyOn(translatorConsent, 'hasTranslatorConsent').mockReturnValue(true);

    act(() => {
      useChatUiStore.setState({
        selectedMessages: [msg1, msg2],
        selectionMode: true,
      });
    });

    vi.spyOn(translatorApi, 'translateText').mockImplementation(async (text) => {
      if (text === 'Good morning') {
        return { translatedText: 'Доброе утро', targetLanguage: 'ru', detectedSourceLang: 'en' };
      }
      throw new Error('Network error');
    });

    await act(async () => {
      await hook.result.current.handleTranslateMessage();
    });

    expect(useChatUiStore.getState().translations['m1']).toBe('Доброе утро');
    expect(useChatUiStore.getState().translations['m2']).toBeUndefined();
    expect(getToasts().some((t) => t.type === 'warning')).toBe(true);
  });
});
