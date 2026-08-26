import type { QueryClient } from '@tanstack/react-query';
import { setChatResolver } from '@/core/chatResolver';
import { queryClient as appQueryClient } from '../queryClient';
import { chatKeys } from '../keys';
import { chatQuery } from './threadQueries';

/**
 * Связывает крипто-слой с кешем запросов.
 *
 * Вызывается один раз при старте: сервисы просят чат через
 * `resolveChat`, а приносит его тот же запрос, которым живут экраны.
 * Раньше эти данные лежали в отдельном `Map` с пятисекундным сроком
 * жизни — шестом хранилище тех же самых чатов.
 *
 * Кеш передаётся параметром, чтобы тест мог связать шифрование со своим
 * клиентом, не повторяя правила ниже.
 */
export function registerChatResolver(queryClient: QueryClient = appQueryClient): void {
  setChatResolver(async (chatId) => {
    const chat = await queryClient.ensureQueryData(chatQuery(chatId));

    // Ключ собеседника мог ещё не появиться на сервере. Запомнить такой
    // ответ значит оставить чат незашифрованным до перезагрузки вкладки,
    // поэтому запись убирается и следующая операция спросит заново.
    //
    // Только сама запись о чате: её ключ — префикс для истории и
    // закреплённых, и удаление по нему унесло бы вместе с чатом всю
    // загруженную ленту.
    if (chat && chat.type !== 'group' && !chat.peerPublicKey) {
      queryClient.removeQueries({ queryKey: chatKeys.detail(chatId), exact: true });
    }

    return chat;
  });
}
