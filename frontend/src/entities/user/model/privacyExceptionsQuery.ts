import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import type { IPrivacyExceptionDto } from './types';
import { userKeys } from './userKeys';

/**
 * Исключения по всем правилам одним запросом (#786): обзору нужны числа по
 * каждому правилу, подстранице — список одного. Делить по правилам проще на
 * месте, чем держать по запросу на правило.
 */
export function privacyExceptionsQuery() {
  return queryOptions({
    queryKey: userKeys.privacyExceptions(),
    queryFn: async (): Promise<IPrivacyExceptionDto[]> =>
      (await services.userService.listPrivacyExceptions()) ?? [],
  });
}
