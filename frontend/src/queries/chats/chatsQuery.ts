import { queryOptions } from '@tanstack/react-query';
import { decryptChatLastMessagePreview } from '@/services/decryptChatPreview';
import { services } from '@/services/serviceContainer';
import type { IChatDto } from '@/types';
import { chatKeys } from '../keys';

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
  [...chats].sort((a, b) => lastActivityAt(b) - lastActivityAt(a));

/**
 * Список чатов.
 *
 * Превью последнего сообщения расшифровывается здесь же: выше по стеку
 * шифртекста быть не должно. Порядок задаётся при чтении — раньше чат
 * поднимал наверх обработчик события, и то, как выглядит список, зависело
 * от того, кто и когда его подвинул.
 */
export function chatsQuery() {
  return queryOptions({
    queryKey: chatKeys.list(),
    queryFn: async () => {
      const chats = await services.chatService.getChats();

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
