import type { ISettingsDto } from './types';

export const DEFAULT_PROFILE_SETTINGS: ISettingsDto = {
  language: 'ru',
  notifications: true,
  sounds: true,
  callSounds: true,
  theme: 'dark',
  avatarShape: 'letter',
};

/**
 * Читает сохранённое предпочтение рингтона (#496/#1002), независимо от sounds.
 * Только отображение сохранённого выбора; effective policy #725 учитывает N и подтверждённый query.
 */
export function selectCallSounds(settings?: Partial<ISettingsDto> | null): boolean {
  return settings?.callSounds ?? DEFAULT_PROFILE_SETTINGS.callSounds ?? true;
}
