import type { QueryClient } from '@tanstack/react-query';
import { setChatResolver, setMembersResolver } from '@/core/chatResolver';
import { queryClient as appQueryClient } from '../queryClient';
import { membersQuery } from './membersQuery';
import { chatQuery } from './threadQueries';

/**
 * Связывает крипто-слой с кешем запросов.
 *
 * Вызывается один раз при старте: сервисы просят чат и его участников
 * через `resolveChat` и `resolveMembers`, а приносит их тот же запрос,
 * которым живут экраны. Раньше эти данные лежали в отдельном `Map` с
 * пятисекундным сроком жизни — шестом хранилище тех же самых чатов.
 *
 * Кеш передаётся параметром, чтобы тест мог связать шифрование со своим
 * клиентом.
 */
export function registerChatResolver(queryClient: QueryClient = appQueryClient): void {
  setChatResolver((chatId) => queryClient.ensureQueryData(chatQuery(chatId)));

  // Ключ чата заворачивается отдельно для каждого участника, поэтому
  // шифрованию нужен их список — и берётся он оттуда же, откуда его
  // показывает интерфейс.
  setMembersResolver((chatId) => queryClient.ensureQueryData(membersQuery(chatId)));
}
