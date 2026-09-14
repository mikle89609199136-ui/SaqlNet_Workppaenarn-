import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { chatKeys } from '@/queries/keys';

/**
 * Участники группы.
 *
 * Раньше список кешировался промисом внутри сервиса и не сбрасывался
 * никогда, кроме ошибки: смена роли и удаление участника правились в
 * состоянии модалки, а после переоткрытия возвращались прежние данные.
 */
export function membersQuery(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.members(chatId),
    queryFn: () => services.chatService.getMembers(chatId),
    staleTime: 60 * 1000,
    enabled: Boolean(chatId),
  });
}
