import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from '@/queries/keys';

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
  return queryOptions({
    queryKey: userKeys.sessions(),
    queryFn: () => services.authService.getSessions(),
    staleTime: 0,
  });
}
