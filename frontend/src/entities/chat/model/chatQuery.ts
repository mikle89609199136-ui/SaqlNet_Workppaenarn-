import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { chatKeys } from './chatKeys';

export function chatQuery(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.detail(chatId),
    queryFn: () => services.chatService.getChat(chatId),
    // Название и участники меняются редко, а об изменениях приходит событие.
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(chatId),
  });
}
