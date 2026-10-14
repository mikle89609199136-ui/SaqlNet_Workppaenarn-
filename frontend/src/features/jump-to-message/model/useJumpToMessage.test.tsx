import { useChatUiStore } from '@/entities/chat';
import { clearToasts, getToasts } from '@/shared/ui';
import { testI18n } from '@/test/harness/i18n';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES_PAGE_SIZE } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { useJumpToMessage } from './useJumpToMessage';

describe('useJumpToMessage', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    useChatUiStore.setState({ highlightedMessageId: null });
    clearToasts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scrolls to message via onScrollToMessage and sets highlight with auto-clear', async () => {
    const onScrollToMessage = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useJumpToMessage({ onScrollToMessage }), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.jumpToMessage('target-msg-1');
    });

    expect(success).toBe(true);
    expect(onScrollToMessage).toHaveBeenCalledWith('target-msg-1');
    expect(useChatUiStore.getState().highlightedMessageId).toBe('target-msg-1');

    // Подсветка исчезает через 1с
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useChatUiStore.getState().highlightedMessageId).toBeNull();
  });

  it('сбрасывает и перезапускает подсветку при повторном переходе к тому же сообщению', async () => {
    const onScrollToMessage = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useJumpToMessage({ onScrollToMessage }), { wrapper });

    await act(async () => {
      await result.current.jumpToMessage('target-msg-1');
    });
    expect(useChatUiStore.getState().highlightedMessageId).toBe('target-msg-1');

    // Прошло 500мс
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useChatUiStore.getState().highlightedMessageId).toBe('target-msg-1');

    // Повторный клик по тому же сообщению
    await act(async () => {
      await result.current.jumpToMessage('target-msg-1');
    });

    // Таймер перезапустился: через 500мс всё ещё подсвечено, через 1000мс гаснет
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useChatUiStore.getState().highlightedMessageId).toBe('target-msg-1');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useChatUiStore.getState().highlightedMessageId).toBeNull();
  });

  it('shows toast when message is not found and cannot load older', async () => {
    const onScrollToMessage = vi.fn().mockReturnValue(false);
    const { result } = renderHook(
      () => useJumpToMessage({ onScrollToMessage, hasMoreOlder: false }),
      {
        wrapper,
      }
    );

    let success = true;
    await act(async () => {
      success = await result.current.jumpToMessage('missing-msg');
    });

    expect(success).toBe(false);
    expect(getToasts()).toContainEqual(
      expect.objectContaining({
        type: 'info',
        message: 'Сообщение находится выше в истории',
      })
    );
  });

  it('attempts to load older messages when message is not in current feed', async () => {
    let loaded = false;
    const onScrollToMessage = vi.fn().mockImplementation(() => loaded);
    const loadOlder = vi.fn().mockImplementation(async () => {
      loaded = true;
    });

    const { result } = renderHook(
      () => useJumpToMessage({ onScrollToMessage, loadOlder, hasMoreOlder: true }),
      { wrapper }
    );

    let success = false;
    await act(async () => {
      const promise = result.current.jumpToMessage('older-msg-1');
      await vi.advanceTimersByTimeAsync(50);
      success = await promise;
    });

    expect(loadOlder).toHaveBeenCalled();
    expect(success).toBe(true);
    expect(useChatUiStore.getState().highlightedMessageId).toBe('older-msg-1');
  });

  it('retries up to 5 times when message is several pages up in history', async () => {
    let attempts = 0;
    const onScrollToMessage = vi.fn().mockImplementation(() => attempts >= 3);
    const loadOlder = vi.fn().mockImplementation(async () => {
      attempts++;
    });

    const { result } = renderHook(
      () => useJumpToMessage({ onScrollToMessage, loadOlder, hasMoreOlder: true }),
      { wrapper }
    );

    let success = false;
    await act(async () => {
      const promise = result.current.jumpToMessage('deep-msg');
      await vi.advanceTimersByTimeAsync(200);
      success = await promise;
    });

    expect(loadOlder).toHaveBeenCalledTimes(3);
    expect(success).toBe(true);
  });

  /* Старое сообщение (#842): сервер говорит, сколько сообщений новее, —
     лента догружается до него, а не на пять страниц наугад. */
  describe('догрузка по позиции сообщения (#842)', () => {
    function deepHistory(pagesUp: number) {
      let pages = 0;
      return {
        onScrollToMessage: vi.fn().mockImplementation(() => pages >= pagesUp),
        loadOlder: vi.fn().mockImplementation(async () => {
          pages++;
        }),
      };
    }

    async function jump(result: { current: ReturnType<typeof useJumpToMessage> }) {
      let success = false;
      await act(async () => {
        const promise = result.current.jumpToMessage('old-msg');
        await vi.advanceTimersByTimeAsync(600);
        success = await promise;
      });
      return success;
    }

    it('сообщение на восьмой странице — догружает восемь, а не пять', async () => {
      const position = vi
        .spyOn(services.messageService, 'getMessagePosition')
        .mockResolvedValue(MESSAGES_PAGE_SIZE * 7 + 10);
      const history = deepHistory(8);
      const { result } = renderHook(
        () => useJumpToMessage({ ...history, hasMoreOlder: true, chatId: 'chat-1' }),
        { wrapper }
      );

      expect(await jump(result)).toBe(true);
      expect(position).toHaveBeenCalledWith('chat-1', 'old-msg');
      expect(history.loadOlder).toHaveBeenCalledTimes(8);
      expect(useChatUiStore.getState().highlightedMessageId).toBe('old-msg');
    });

    it('позицию узнать не удалось — пять страниц, как раньше', async () => {
      vi.spyOn(services.messageService, 'getMessagePosition').mockRejectedValue(new Error('404'));
      const history = deepHistory(8);
      const { result } = renderHook(
        () => useJumpToMessage({ ...history, hasMoreOlder: true, chatId: 'chat-1' }),
        { wrapper }
      );

      expect(await jump(result)).toBe(false);
      expect(history.loadOlder).toHaveBeenCalledTimes(5);
      expect(getToasts()).toContainEqual(
        expect.objectContaining({ message: 'Сообщение находится выше в истории' })
      );
    });
  });
});
