import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideo } from './useVideo';

describe('useVideo', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      get() {
        return this._paused ?? true;
      },
      set(v) {
        this._paused = v;
      },
      configurable: true,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function (
      this: HTMLMediaElement
    ) {
      (this as any)._paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    window.HTMLMediaElement.prototype.pause = vi.fn().mockImplementation(function (
      this: HTMLMediaElement
    ) {
      (this as any)._paused = true;
      this.dispatchEvent(new Event('pause'));
    });
  });

  it('1. инициализирует состояние по умолчанию', () => {
    const { result } = renderHook(() => useVideo());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
    expect(result.current.isMuted).toBe(true);
  });

  it('2. корректно форматирует время', () => {
    const { result } = renderHook(() => useVideo());

    expect(result.current.formatTime(0)).toBe('0:00');
    expect(result.current.formatTime(65)).toBe('1:05');
    expect(result.current.formatTime(130)).toBe('2:10');
    expect(result.current.formatTime(NaN)).toBe('0:00');
  });

  it('3. переключает mute и восстанавливает громкость если volume === 0', () => {
    const { result } = renderHook(() => useVideo());

    act(() => {
      result.current.changeVolume(0);
    });
    expect(result.current.volume).toBe(0);

    // Включаем звук — громкость должна сброситься на 1
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(false);
    expect(result.current.volume).toBe(1);

    // Выключаем звук
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(true);
  });

  it('4. меняет громкость с ограничением диапазона 0..1', () => {
    const { result } = renderHook(() => useVideo());

    act(() => {
      result.current.changeVolume(0.7);
    });
    expect(result.current.volume).toBe(0.7);

    act(() => {
      result.current.changeVolume(1.5);
    });
    expect(result.current.volume).toBe(1);

    act(() => {
      result.current.changeVolume(-0.5);
    });
    expect(result.current.volume).toBe(0);
  });

  it('5. не возобновляет воспроизведение на handleCanPlay если пользователь поставил паузу', () => {
    const { result } = renderHook(() => useVideo());
    const video = document.createElement('video');
    Object.defineProperty(result.current.mediaRef, 'current', {
      value: video,
      writable: true,
    });

    // Пользователь ставит паузу
    act(() => {
      result.current.togglePlay(); // play
    });
    expect(video.play).toHaveBeenCalled();

    act(() => {
      result.current.togglePlay(); // user pause
    });
    expect(video.pause).toHaveBeenCalled();
    vi.clearAllMocks();

    // Приходит событие canplay
    act(() => {
      result.current.handleCanPlay();
    });
    // Воспроизведение НЕ должно возобновиться
    expect(video.play).not.toHaveBeenCalled();
  });
});
