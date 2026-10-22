import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isChatMuted, useChatMuted } from './notificationMute';

describe('персональный mute и expiry', () => {
  it('применяет бессрочный/будущий mute, но не истёкший', () => {
    expect(isChatMuted({ isMuted: true })).toBe(true);
    expect(isChatMuted({ isMuted: true, mutedUntil: new Date(2000).toISOString() }, 1000)).toBe(
      true
    );
    expect(isChatMuted({ isMuted: true, mutedUntil: new Date(2000).toISOString() }, 2000)).toBe(
      false
    );
    expect(isChatMuted({ isMuted: true, mutedUntil: 'invalid' })).toBe(true);
  });
  it('открытая строка снимает quiet badge по времени без нового сообщения', () => {
    vi.useFakeTimers();
    const mutedUntil = new Date(Date.now() + 1000).toISOString();
    const { result, unmount } = renderHook(() => useChatMuted({ isMuted: true, mutedUntil }));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1001));
    expect(result.current).toBe(false);
    unmount();
    vi.useRealTimers();
  });
});
