import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen } from './useFullscreen';

describe('useFullscreen', () => {
  let requestFullscreenMock: any;
  let target: HTMLElement;

  beforeEach(() => {
    target = document.createElement('div');
    requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    target.requestFullscreen = requestFullscreenMock;
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  it('1. инициализирует isFullscreen как false', () => {
    const targetRef = { current: target };
    const { result } = renderHook(() => useFullscreen(targetRef));

    expect(result.current.isFullscreen).toBe(false);
  });

  it('2. вызывает requestFullscreen при toggleFullscreen', () => {
    const targetRef = { current: target };
    const { result } = renderHook(() => useFullscreen(targetRef));

    act(() => {
      result.current.toggleFullscreen();
    });

    expect(requestFullscreenMock).toHaveBeenCalled();
  });

  it('3. обновляет isFullscreen при событии fullscreenchange', () => {
    const targetRef = { current: target };
    const { result } = renderHook(() => useFullscreen(targetRef));

    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: target,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isFullscreen).toBe(true);

    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isFullscreen).toBe(false);
  });
});
