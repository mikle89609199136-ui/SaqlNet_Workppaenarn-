import { DEFAULT_PROFILE_SETTINGS } from '@/consts';
import { useProfileStore } from '@/store/profile';
import type { ISettingsDto, IUserDto } from '@/types';
import { services } from '@/services/serviceContainer';

/**
 * Настройки для только что вошедшего.
 *
 * Отдельно от общего запроса настроек: там ошибка должна быть видна, а
 * здесь нет. Человек только что ввёл верный пароль — не пускать его в
 * приложение из-за неотвеченного запроса оформления неправильно, поэтому
 * при неудаче берутся значения по умолчанию.
 */
export async function fetchUserSettings(): Promise<ISettingsDto> {
  try {
    const data = await services.userService.getSettings();
    return data.settings || DEFAULT_PROFILE_SETTINGS;
  } catch (_error) {
    return DEFAULT_PROFILE_SETTINGS;
  }
}

export function uploadAvatar(avatar: string) {
  if (!avatar) return Promise.resolve();
  return services.userService.updateAvatar(avatar);
}

/**
 * Разложить подтверждённый вход по местам.
 *
 * Событие в конце — не украшение: по нему `serviceContainer` поднимает
 * ключи шифрования для нового пользователя. Без него человек войдёт, но
 * переписка останется нечитаемой.
 *
 * Настройки необязательны: при регистрации их ещё неоткуда взять, у
 * нового аккаунта они и так пустые.
 */
export function saveAuthSession({
  settings,
  token,
  user,
}: {
  settings?: ISettingsDto;
  token: string;
  user: IUserDto;
}) {
  useProfileStore.getState().setToken(token);
  useProfileStore.getState().setUser(user);
  if (settings) useProfileStore.getState().setSettings(settings);
  window.dispatchEvent(new CustomEvent('craneapp:auth-session-saved'));
}
