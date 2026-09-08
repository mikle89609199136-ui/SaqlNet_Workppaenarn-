import { useChatUiStore } from '@/store';
import { clearToasts, getToasts } from '@/shared/ui';
import { testI18n } from '@/test/harness/i18n';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    // Подсветка исчезает через 1.8с
    act(() => {
      vi.advanceTimersByTime(1800);
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
});
