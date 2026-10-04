import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import {
  formatVolume,
  getVoiceVolume,
  setVoiceVolume,
  toggleVoiceMute,
  useVoiceVolume,
} from './voiceVolume';

describe('громкость голосовых на устройстве (#874)', () => {
  beforeEach(() => {
    setVoiceVolume(1);
  });

  it('уровень сохраняется на устройстве', () => {
    setVoiceVolume(0.35);

    expect(getVoiceVolume()).toBe(0.35);
    expect(localStorage.getItem(STORAGE_KEYS.VOICE_VOLUME)).toBe('0.35');
  });

  it('уровень — от 0 до 100%', () => {
    setVoiceVolume(1.7);
    expect(getVoiceVolume()).toBe(1);
    setVoiceVolume(-0.2);
    expect(getVoiceVolume()).toBe(0);
  });

  it('выключение звука возвращает к прежнему уровню, а не к 100%', () => {
    setVoiceVolume(0.6);

    toggleVoiceMute();
    expect(getVoiceVolume()).toBe(0);
    toggleVoiceMute();
    expect(getVoiceVolume()).toBe(0.6);
  });

  it('подписчики узнают о новом уровне', () => {
    const { result } = renderHook(() => useVoiceVolume());

    act(() => setVoiceVolume(0.5));

    expect(result.current).toBe(0.5);
  });

  it('диктору — проценты', () => {
    expect(formatVolume(0.55)).toBe('55%');
  });
});
