import { STORAGE_KEYS } from '@/shared/config';
import { useSyncExternalStore } from 'react';
import { setVoicePlaybackLevel } from './playbackGain';

const listeners = new Set<() => void>();

const clampLevel = (level: number) => Math.min(1, Math.max(0, level));

function readLevel(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.VOICE_VOLUME);
    const parsed = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(parsed) ? clampLevel(parsed) : 1;
  } catch {
    return 1;
  }
}

function persistLevel(value: number) {
  try {
    localStorage.setItem(STORAGE_KEYS.VOICE_VOLUME, String(value));
  } catch {
    return;
  }
}

let level = readLevel();
let audibleLevel = level || 1;
setVoicePlaybackLevel(level);

export function getVoiceVolume(): number {
  return level;
}

export function setVoiceVolume(next: number): void {
  level = clampLevel(next);
  if (level > 0) audibleLevel = level;
  persistLevel(level);
  setVoicePlaybackLevel(level);
  listeners.forEach((notify) => notify());
}

export function toggleVoiceMute(): void {
  setVoiceVolume(level > 0 ? 0 : audibleLevel);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useVoiceVolume(): number {
  return useSyncExternalStore(subscribe, getVoiceVolume, getVoiceVolume);
}

export const formatVolume = (value: number) => `${Math.round(value * 100)}%`;
