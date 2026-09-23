import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';
import type { IAllSettingsDto } from './types';

/**
 * Все настройки пользователя единым запросом.
 */
export function allSettingsQuery() {
  return queryOptions<IAllSettingsDto>({
    queryKey: userKeys.allSettings(),
    queryFn: () => services.userService.getAllSettings(),
    staleTime: 5 * 60 * 1000,
  });
}
