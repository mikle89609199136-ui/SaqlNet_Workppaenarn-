import { DEFAULT_PROFILE_SETTINGS } from '@/entities/user/model/defaultProfileSettings';
import { useProfileStore } from '@/entities/user/model/profileStore';
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

export async function uploadAvatar(avatar: File | string | null | undefined): Promise<void> {
  if (!avatar) return;
  if (typeof avatar === 'string') {
    await services.userService.updateAvatar(avatar);
    return;
  }
  // Файл уже пересжат при выборе (RegisterWizard, encodeAvatar).
  const { url } = await services.mediaService.upload(avatar);
  await services.userService.updateAvatar(url);
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
export function saveAuthSession({ settings, user }: { settings?: ISettingsDto; user: IUserDto }) {
  // Сама сессия уже в cookie — её поставил ответ сервера на вход (#705).
  useProfileStore.getState().setUser(user);
  if (settings) useProfileStore.getState().setSettings(settings);
  window.dispatchEvent(new CustomEvent('craneapp:auth-session-saved'));
}
