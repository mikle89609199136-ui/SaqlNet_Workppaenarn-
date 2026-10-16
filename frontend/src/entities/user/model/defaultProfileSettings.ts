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
 * Извлекает флаг включения звука звонка с учётом настроек по умолчанию (#1002).
 */
export function selectCallSounds(settings?: Partial<ISettingsDto> | null): boolean {
  return settings?.callSounds ?? DEFAULT_PROFILE_SETTINGS.callSounds ?? true;
}
