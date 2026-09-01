import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from '../keys';

/**
 * Данные раздела безопасности.
 *
 * Раньше страница показывала их из `useState`: «сеансов нет» и «вторая
 * ступень отключена» независимо от действительности. В разделе, куда
 * заходят проверить, не вошёл ли кто-то чужой, придуманный ответ хуже
 * пустого экрана — поэтому теперь спрашиваем сервер, а состояние
 * «неизвестно» показываем как неизвестное.
 *
 * Обновляются при каждом открытии: список устройств меняется не по
 * действиям в этой вкладке, и показывать его из кеша нельзя.
 */
export function sessionsQuery() {
  return queryOptions({
    queryKey: userKeys.sessions(),
    queryFn: () => services.authService.getSessions(),
    staleTime: 0,
  });
}

export function twoFAStatusQuery() {
  return queryOptions({
    queryKey: userKeys.twoFA(),
    queryFn: () => services.authService.getTwoFAStatus(),
    staleTime: 0,
  });
}
