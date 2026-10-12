import { queryClient } from '@/shared/api';
import { type ISettingsPayloadDto, userKeys, useProfileStore } from '@/entities/user';

/**
 * Хук для чтения флага воспроизведения звука звонка из настроек пользователя (#1002).
 * По умолчанию true, если настройка ещё не задана в профиле.
 */
export function useCallSounds(): boolean {
  return useProfileStore((s) => s.settings.callSounds ?? s.settings.sounds ?? true);
}

/**
 * Чтение флага воспроизведения звука звонка вне компонентов (внутри FSM / store / сервисов).
 * Проверяет кэш React Query, затем useProfileStore, поддерживая обратную совместимость с sounds.
 */
export function getCallSoundsEnabled(): boolean {
  const querySettings = queryClient.getQueryData<ISettingsPayloadDto>(
    userKeys.settings()
  )?.settings;
  if (querySettings?.callSounds !== undefined) {
    return querySettings.callSounds;
  }

  const storeSettings = useProfileStore.getState().settings;
  if (storeSettings.callSounds !== undefined) {
    return storeSettings.callSounds;
  }

  if (querySettings?.sounds !== undefined) {
    return querySettings.sounds;
  }
  if (storeSettings.sounds !== undefined) {
    return storeSettings.sounds;
  }

  return true;
}
