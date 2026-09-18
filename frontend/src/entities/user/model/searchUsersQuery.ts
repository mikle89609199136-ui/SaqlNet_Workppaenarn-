import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';

/** Короче двух знаков сервер ничего осмысленного не вернёт. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * Поиск людей по имени и имени пользователя.
 *
 * В отличие от чатов, которые целиком лежат в кеше и фильтруются на
 * месте, людей приходится спрашивать у сервера: в списке чатов их нет,
 * пока с ними не начали переписку.
 *
 * Ответ считается свежим полминуты — этого хватает, чтобы возврат к тому
 * же запросу (стёр букву и написал заново) не шёл на сервер, и мало,
 * чтобы новый человек в системе нашёлся без перезагрузки.
 */
export function searchUsersQuery(query: string) {
  const normalized = query.trim().replace(/^@/, '');

  return queryOptions({
    queryKey: userKeys.search(normalized),
    queryFn: () => services.chatService.searchUsers(normalized),
    staleTime: 30 * 1000,
    enabled: normalized.length >= MIN_SEARCH_LENGTH,
  });
}
