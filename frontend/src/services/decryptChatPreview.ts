import { services } from '@/services/serviceContainer';
import type { ILastMessageDto } from '@/types';

export async function decryptChatLastMessagePreview(
  chatId: string,
  lastMessage: ILastMessageDto
): Promise<ILastMessageDto> {
  /* Звонок не зашифрован: в содержимом служебный JSON с длительностью.
     Подпись «Звонок завершен · 1:05» собирает интерфейс
     (getLastMessageText, formatCallPreview) — он знает язык, сервис нет. */
  if (lastMessage.type === 'call') return lastMessage;

  try {
    const message = await services.messageService.processLastMessageForDisplay(chatId, lastMessage);
    return message;
  } catch (error) {
    console.warn('Failed to decrypt chat preview', error);
    return lastMessage;
  }
}
