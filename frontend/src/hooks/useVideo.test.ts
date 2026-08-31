import { renderHook } from '@testing-library/react';
import { useVideo } from './useVideo';
import { describe, expect, it } from 'vitest';

describe('useVideo', () => {
  it('should initialize with default states', () => {
    const { result } = renderHook(() => useVideo());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
  });

  it('should format time correctly', () => {
    const { result } = renderHook(() => useVideo());

    expect(result.current.formatTime(0)).toBe('0:00');
    expect(result.current.formatTime(65)).toBe('1:05');
    expect(result.current.formatTime(130)).toBe('2:10');
    expect(result.current.formatTime(NaN)).toBe('0:00');
  });
});
