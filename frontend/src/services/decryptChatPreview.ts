import { services } from '@/services/serviceContainer';
import type { ILastMessageDto } from '@/entities/chat';
import { formatCallPreview } from '@/shared/lib';

export async function decryptChatLastMessagePreview(
  chatId: string,
  lastMessage: ILastMessageDto
): Promise<ILastMessageDto> {
  if (lastMessage.type === 'call') {
    return {
      ...lastMessage,
      content: formatCallPreview(lastMessage.content),
    };
  }

  try {
    const message = await services.messageService.processLastMessageForDisplay(chatId, lastMessage);
    return message;
  } catch (error) {
    console.warn('Failed to decrypt chat preview', error);
    return lastMessage;
  }
}
