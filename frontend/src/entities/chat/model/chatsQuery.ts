import { queryOptions } from '@tanstack/react-query';
import { decryptChatLastMessagePreview } from '@/services/decryptChatPreview';
import { services } from '@/services/serviceContainer';
import type { IChatDto } from '@/types';
import { chatKeys } from '@/queries/keys';

function lastActivityAt(chat: IChatDto): number {
  const value = chat.lastMessageAt ?? chat.updatedAt ?? chat.createdAt;
  return value ? new Date(value).getTime() : 0;
}

/**
 * Порядок чатов: сверху те, где недавно писали.
 *
 * Функция объявлена на уровне модуля намеренно. `select` вызывается при
 * каждом рендере, и если передавать новую функцию, её результат не
 * переиспользуется: каждый раз получается новый массив, подписчики видят
 * изменение и рендерятся снова — до исчерпания лимита вложенных обновлений.
 */
const selectSortedChats = (chats: IChatDto[]) =>
  [...chats].sort((a, b) => {
    /* Закреплённые сверху. Сервер отдаёт их первыми и сам
       (`ORDER BY is_pinned DESC` в chat/service.go), но клиент
       пересортировывал всё по времени и это затирал: закреплённый чат
       опускался вниз, как обычный. */
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return lastActivityAt(b) - lastActivityAt(a);
  });

/**
 * Список чатов.
 *
 * Превью последнего сообщения расшифровывается здесь же: выше по стеку
 * шифртекста быть не должно. Порядок задаётся при чтении — раньше чат
 * поднимал наверх обработчик события, и то, как выглядит список, зависело
 * от того, кто и когда его подвинул.
 */
export function chatsQuery({ archived = false } = {}) {
  return queryOptions({
    queryKey: archived ? chatKeys.archived() : chatKeys.list(),
    queryFn: async () => {
      const chats = await services.chatService.getChats(archived);

      return Promise.all(
        chats.map(async (chat) => ({
          ...chat,
          lastMessage: chat.lastMessage
            ? await decryptChatLastMessagePreview(chat.id, chat.lastMessage)
            : chat.lastMessage,
        }))
      );
    },
    select: selectSortedChats,
    staleTime: 30 * 1000,
  });
}
