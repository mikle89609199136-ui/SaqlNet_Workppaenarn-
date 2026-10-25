import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '@/shared/config';
import { DEFAULT_PROFILE_SETTINGS } from './defaultProfileSettings';
import type { ISettingsDto } from './types';

export const PALETTES = ['graphite', 'midnight', 'warm'] as const;
export const ACCENTS = ['violet', 'plum', 'orchid', 'indigo', 'amber', 'teal'] as const;
export const TEXT_SIZES = ['small', 'medium', 'large'] as const;
export const CHAT_DENSITIES = ['compact', 'normal', 'large'] as const;
export type TPalette = (typeof PALETTES)[number];
export type TAccent = (typeof ACCENTS)[number];

export function normalizePreferences(settings?: Partial<ISettingsDto>): Required<ISettingsDto> {
  const result: Required<ISettingsDto> = { ...DEFAULT_PROFILE_SETTINGS, ...settings };
  for (const [key, values] of Object.entries({
    theme: ['light', 'dark', 'system'],
    palette: PALETTES,
    accentPreset: ACCENTS,
    textSize: TEXT_SIZES,
    chatDensity: CHAT_DENSITIES,
    avatarShape: ['letter', 'grid'],
  }) as [keyof ISettingsDto, readonly string[]][]) {
    if (!values.includes(String(result[key]))) {
      Object.assign(result, { [key]: DEFAULT_PROFILE_SETTINGS[key as keyof ISettingsDto] });
    }
  }
  for (const key of [
    'showMessageTime',
    'showMessageStatus',
    'showMessageAvatars',
    'groupConsecutiveMessages',
  ] as const) {
    if (typeof result[key] !== 'boolean') result[key] = DEFAULT_PROFILE_SETTINGS[key];
  }
  return result;
}

/** Старый выбор переносится только по явному действию: дефолт сервера тоже может быть выбором пользователя. */
export function readLegacyAppearance(): Partial<ISettingsDto> | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.APPEARANCE) || 'null');
    if (!stored || typeof stored !== 'object') return null;
    const patch: Partial<ISettingsDto> = {};
    if (PALETTES.includes(stored.palette)) patch.palette = stored.palette;
    if (ACCENTS.includes(stored.accent)) patch.accentPreset = stored.accent;
    return Object.keys(patch).length ? patch : null;
  } catch {
    return null;
  }
}

export function applyAppearance(settings: Required<ISettingsDto>, systemDark: boolean): void {
  const root = document.documentElement;
  root.dataset.themePreference = settings.theme;
  root.dataset.theme =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
  for (const [attribute, value, fallback] of [
    ['palette', settings.palette, 'graphite'],
    ['accent', settings.accentPreset, 'violet'],
    ['text-size', settings.textSize, 'medium'],
    ['chat-density', settings.chatDensity, 'normal'],
  ]) {
    if (value === fallback) root.removeAttribute(`data-${attribute}`);
    else root.setAttribute(`data-${attribute}`, value);
  }
}

const systemQuery = '(prefers-color-scheme: dark)';
function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia(systemQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia(systemQuery).matches,
    () => false
  );
}
