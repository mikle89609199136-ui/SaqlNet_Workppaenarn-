import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdle } from './useIdle';

describe('useIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. переходит в idle состояние по истечении таймаута', () => {
    const { result } = renderHook(() => useIdle({ enabled: true, timeoutMs: 2000 }));

    expect(result.current.isIdle).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isIdle).toBe(true);
  });

  it('2. сбрасывает idle при resetIdle', () => {
    const { result } = renderHook(() => useIdle({ enabled: true, timeoutMs: 2000 }));

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.isIdle).toBe(true);

    act(() => {
      result.current.resetIdle();
    });
    expect(result.current.isIdle).toBe(false);
  });

  it('3. не становится idle если enabled: false', () => {
    const { result } = renderHook(() => useIdle({ enabled: false, timeoutMs: 2000 }));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.isIdle).toBe(false);
  });

  it('4. скрывает элементы управления немедленно при hideControls', () => {
    const { result } = renderHook(() => useIdle({ enabled: true, timeoutMs: 2000 }));

    expect(result.current.isIdle).toBe(false);

    act(() => {
      result.current.hideControls();
    });

    expect(result.current.isIdle).toBe(true);
  });
});
