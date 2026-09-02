import { renderHook } from '@testing-library/react';
import { useAudio } from './useAudio';
import { describe, expect, it } from 'vitest';

describe('useAudio', () => {
  it('should initialize with default states', () => {
    const { result } = renderHook(() => useAudio());
    
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
  });

  it('should format time correctly', () => {
    const { result } = renderHook(() => useAudio());
    
    expect(result.current.formatTime(0)).toBe('0:00');
    expect(result.current.formatTime(65)).toBe('1:05');
    expect(result.current.formatTime(130)).toBe('2:10');
    expect(result.current.formatTime(NaN)).toBe('0:00');
  });
});
