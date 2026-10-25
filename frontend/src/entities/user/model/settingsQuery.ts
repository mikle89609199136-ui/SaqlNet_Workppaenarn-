import { CancelledError, queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import { isSettingsSession, settingsSession } from './settingsSession';
import { settingsWritesPending } from './settingsWrites';
import type { ISettingsPayloadDto } from './types';

/**
 * Настройки и параметры приватности.
 *
 * Сервер отдаёт их одним ответом, поэтому и запрос один: разделение на
 * два создало бы два состояния загрузки для одного экрана.
 */
export function settingsQuery() {
  const session = settingsSession();
  return queryOptions({
    queryKey: userKeys.settings(session),
    queryFn: async ({ signal, client }): Promise<ISettingsPayloadDto> => {
      // Consuming signal lets Query cancel even a service that cannot abort its HTTP request.
      if (signal.aborted || !isSettingsSession(session) || settingsWritesPending(client, session))
        throw new CancelledError({ revert: true });
      const data = await services.userService.getSettings();
      if (signal.aborted || !isSettingsSession(session) || settingsWritesPending(client, session))
        throw new CancelledError({ revert: true });
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
