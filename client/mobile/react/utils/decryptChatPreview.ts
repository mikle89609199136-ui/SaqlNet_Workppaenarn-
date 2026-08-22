import { services } from "@/services";
import type { ILastMessageDto } from "@/types";
import { formatCallPreview } from "./call";

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