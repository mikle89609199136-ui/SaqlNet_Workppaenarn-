import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/shared/api';
import {
  type ISettingsPayloadDto,
  selectCallSounds,
  settingsQuery,
  userKeys,
  useProfileStore,
} from '@/entities/user';

/**
 * Хук для чтения флага воспроизведения звука звонка из настроек пользователя (#1002).
 * Читает кэш запросов настроек через selectCallSounds с запасным вариантом в useProfileStore.
 */
export function useCallSounds(): boolean {
  const { data } = useQuery({ ...settingsQuery(), enabled: false });
  const storeSettings = useProfileStore((s) => s.settings);

  return selectCallSounds(data?.settings ?? storeSettings);
}

/**
 * Чтение флага воспроизведения звука звонка вне компонентов (внутри FSM / store / сервисов).
 * Проверяет кэш React Query, затем useProfileStore, вычисляя значение через selectCallSounds (#1002).
 */
export function getCallSoundsEnabled(): boolean {
  const querySettings = queryClient.getQueryData<ISettingsPayloadDto>(
    userKeys.settings()
  )?.settings;
  if (querySettings) {
    return selectCallSounds(querySettings);
  }

  const storeSettings = useProfileStore.getState().settings;
  return selectCallSounds(storeSettings);
}
