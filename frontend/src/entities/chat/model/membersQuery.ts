import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { chatKeys } from './chatKeys';

/**
 * Участники группы.
 *
 * Раньше список кешировался промисом внутри сервиса и не сбрасывался
 * никогда, кроме ошибки: смена роли и удаление участника правились в
 * состоянии модалки, а после переоткрытия возвращались прежние данные.
 */
/**
 * Кто из участников группы в сети — для подзаголовка «5 участников, 2 в
 * сети» (#822). Перечитывается раз в полминуты, пока шапка на экране:
 * события присутствия приходят по людям, а не по группам.
 */
export function onlineMembersQuery(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.membersOnline(chatId),
    queryFn: () => services.chatService.getOnlineMembers(chatId),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    enabled: Boolean(chatId),
  });
}

export function membersQuery(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.members(chatId),
    queryFn: () => services.chatService.getMembers(chatId),
    staleTime: 60 * 1000,
    enabled: Boolean(chatId),
  });
}
