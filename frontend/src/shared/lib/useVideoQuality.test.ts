import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useVideoQuality } from './useVideoQuality';

describe('useVideoQuality', () => {
  it('1. инициализирует качество без sources', () => {
    const { result } = renderHook(() => useVideoQuality({ src: 'default.mp4' }));

    expect(result.current.hasSources).toBe(false);
    expect(result.current.quality).toBe('Авто');
    expect(result.current.activeSrc).toBe('default.mp4');
    expect(result.current.qualityOpen).toBe(false);
  });

  it('2. инициализирует качество с несколькими sources', () => {
    const sources = [
      { label: '1080p', url: '1080.mp4' },
      { label: '720p', url: '720.mp4' },
    ];
    const { result } = renderHook(() => useVideoQuality({ src: 'default.mp4', sources }));

    expect(result.current.hasSources).toBe(true);
    expect(result.current.quality).toBe('1080p');
    expect(result.current.activeSrc).toBe('1080.mp4');
  });

  it('3. меняет качество при handleQualityChange', () => {
    const sources = [
      { label: '1080p', url: '1080.mp4' },
      { label: '720p', url: '720.mp4' },
    ];
    const { result } = renderHook(() => useVideoQuality({ src: 'default.mp4', sources }));

    act(() => {
      result.current.handleQualityChange('720.mp4', '720p');
    });

    expect(result.current.quality).toBe('720p');
    expect(result.current.activeSrc).toBe('720.mp4');
    expect(result.current.qualityOpen).toBe(false);
  });

  it('4. открывает и закрывает меню качества', () => {
    const { result } = renderHook(() => useVideoQuality());

    act(() => {
      result.current.setQualityOpen(true);
    });
    expect(result.current.qualityOpen).toBe(true);

    act(() => {
      result.current.setQualityOpen(false);
    });
    expect(result.current.qualityOpen).toBe(false);
  });
});
