import { CancelledError, queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import { settingsSession, isSettingsSession } from './settingsSession';

/**
 * Список активных сеансов.
 *
 * Раньше страница показывала «сеансов нет» из `useState` — независимо от
 * действительности. В разделе, куда заходят проверить, не вошёл ли
 * кто-то чужой, придуманный ответ хуже пустого экрана.
 *
 * Обновляется при каждом открытии: список устройств меняется не по
 * действиям в этой вкладке, и показывать его из кеша нельзя.
 */
export function sessionsQuery() {
  const session = settingsSession();
  return queryOptions({
    queryKey: userKeys.sessions(session),
    queryFn: async ({ signal }) => {
      const sessions = await services.authService.getSessions();
      if (signal.aborted || !isSettingsSession(session)) throw new CancelledError();
      return sessions;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
