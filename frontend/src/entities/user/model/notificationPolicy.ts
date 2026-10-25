import type { QueryClient } from '@tanstack/react-query';
import type { ISettingsDto, ISettingsPayloadDto } from './types';
import { userKeys } from './userKeys';
import { settingsQuery } from './settingsQuery';

export interface INotificationFlags {
  notifications: boolean;
  sounds: boolean;
  callSounds: boolean;
}
const disabled: INotificationFlags = { notifications: false, sounds: false, callSounds: false };
function currentSettingsMutation(key: readonly unknown[] | undefined): boolean {
  const current = userKeys.settings();
  return Boolean(key && current.every((part, index) => key[index] === part));
}

/** Defaults допустимы только внутри полученного серверного settings object. */
export function notificationFlags(settings?: Partial<ISettingsDto> | null): INotificationFlags {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return disabled;
  const flag = (key: keyof INotificationFlags) => !(key in settings) || settings[key] === true;
  const notifications = flag('notifications');
  return {
    notifications,
    sounds: notifications && flag('sounds'),
    callSounds: notifications && flag('callSounds'),
  };
}

export function notificationSettingsPending(client: QueryClient): boolean {
  return client
    .getMutationCache()
    .getAll()
    .some(
      (mutation) =>
        mutation.state.status === 'pending' && currentSettingsMutation(mutation.options.mutationKey)
    );
}

export function getNotificationFlags(client: QueryClient): INotificationFlags {
  if (client.getQueryState(userKeys.settings())?.status !== 'success') return disabled;
  const flags = {
    ...notificationFlags(client.getQueryData<ISettingsPayloadDto>(userKeys.settings())?.settings),
  };
  // Выключение действует сразу, включение — после commit. S не маскирует C.
  for (const mutation of client.getMutationCache().getAll()) {
    if (
      mutation.state.status !== 'pending' ||
      !currentSettingsMutation(mutation.options.mutationKey)
    )
      continue;
    const variables = mutation.state.variables as
      (Partial<ISettingsDto> & { patch?: Partial<ISettingsDto> }) | undefined;
    const patch = variables?.patch ?? variables;
    if (patch?.notifications === true) return disabled;
    if (patch?.sounds === true) flags.sounds = false;
    if (patch?.callSounds === true) flags.callSounds = false;
  }
  return flags;
}

/** Не воспроизводим событие позднее, если его допуск проверить не удалось. */
export async function refreshNotificationSettings(client: QueryClient): Promise<boolean> {
  if (notificationSettingsPending(client)) return false;
  try {
    await client.fetchQuery({ ...settingsQuery(), staleTime: 0, retry: false });
    return !notificationSettingsPending(client);
  } catch {
    return false;
  }
}
