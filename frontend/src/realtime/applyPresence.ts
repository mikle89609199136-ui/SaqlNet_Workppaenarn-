import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { chatKeys, type IChatDto } from '@/entities/chat';
import { userKeys } from '@/entities/user';
import type { IPresenceChangedEvent } from '@/types';

/**
 * Статус собеседника «в сети» / «был(а)» (#780).
 *
 * Статус живёт в трёх местах кеша: в списке чатов, в карточке личного чата
 * (шапка) и в профиле. Событие кладёт его во все три сразу, без похода на
 * сервер, — раньше он менялся только после перезагрузки страницы.
 */

/** Карточки чатов: ключи вида ['chat', chatId], без истории и закреплённых. */
function chatDetailKeys(queryClient: QueryClient): QueryKey[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: chatKeys.all })
    .map((query) => query.queryKey)
    .filter((key) => key.length === 2 && key[1] !== 'list' && key[1] !== 'archived');
}

export function applyPresence(queryClient: QueryClient, event: IPresenceChangedEvent): void {
  if (!event?.userId) return;

  const patch = (chat: IChatDto | undefined): IChatDto | undefined =>
    chat && chat.type === 'private' && chat.peerId === event.userId
      ? { ...chat, peerIsOnline: event.isOnline, peerLastSeen: event.lastSeen || chat.peerLastSeen }
      : chat;

  for (const key of [chatKeys.list(), chatKeys.archived()]) {
    queryClient.setQueryData<IChatDto[]>(key, (chats) => chats?.map((chat) => patch(chat)!));
  }
  for (const key of chatDetailKeys(queryClient)) {
    queryClient.setQueryData<IChatDto>(key, (chat) => patch(chat));
  }
  queryClient.setQueryData<{ isOnline?: boolean }>(userKeys.profile(event.userId), (profile) =>
    profile ? { ...profile, isOnline: event.isOnline } : profile
  );
}

/**
 * Перечитать статусы, когда события могли пройти мимо: связь моргала или
 * вкладка спала. Только список и карточки — история чатов не трогается.
 */
export function refreshPresence(queryClient: QueryClient): void {
  for (const key of [chatKeys.list(), chatKeys.archived(), ...chatDetailKeys(queryClient)]) {
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }
}
