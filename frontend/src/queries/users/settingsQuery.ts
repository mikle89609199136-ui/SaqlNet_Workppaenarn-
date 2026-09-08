import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from '../keys';

/**
 * Настройки и параметры приватности.
 *
 * Сервер отдаёт их одним ответом, поэтому и запрос один: разделение на
 * два создало бы два состояния загрузки для одного экрана.
 */
export function settingsQuery() {
  return queryOptions({
    queryKey: userKeys.settings(),
    queryFn: () => services.userService.getSettings(),
    staleTime: 5 * 60 * 1000,
  });
}
