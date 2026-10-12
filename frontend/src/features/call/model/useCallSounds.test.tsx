import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProfileStore, DEFAULT_PROFILE_SETTINGS, selectCallSounds } from '@/entities/user';
import { useCallSounds, getCallSoundsEnabled } from './useCallSounds';

describe('useCallSounds & getCallSoundsEnabled (#1002)', () => {
  beforeEach(() => {
    useProfileStore.setState({
      settings: { ...DEFAULT_PROFILE_SETTINGS },
    });
  });

  it('по умолчанию звук звонка включён', () => {
    expect(getCallSoundsEnabled()).toBe(true);

    const { result } = renderHook(() => useCallSounds());
    expect(result.current).toBe(true);
  });

  it('возвращает false, если звук звонков отключён в настройках', () => {
    useProfileStore.setState({
      settings: { ...DEFAULT_PROFILE_SETTINGS, callSounds: false },
    });

    expect(getCallSoundsEnabled()).toBe(false);

    const { result } = renderHook(() => useCallSounds());
    expect(result.current).toBe(false);
  });

  it('selectCallSounds корректно извлекает значение с фоллбэком на true', () => {
    expect(selectCallSounds(undefined)).toBe(true);
    expect(selectCallSounds(null)).toBe(true);
    expect(selectCallSounds({})).toBe(true);
    expect(selectCallSounds({ callSounds: false })).toBe(false);
    expect(selectCallSounds({ callSounds: true })).toBe(true);
  });
});
