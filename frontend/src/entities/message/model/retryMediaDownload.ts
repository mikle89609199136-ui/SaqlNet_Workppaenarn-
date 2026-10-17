import type { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import { patchThreadMessage } from './threadCacheActions';
import type { IMediaItem, IMessageDto } from './types';

/**
 * Скачать вложение ещё раз — «Повторить» под «Не удалось загрузить медиа» (#1062).
 *
 * Неудачу реестр расшифрованного медиа не запоминает, поэтому тот же путь,
 * что при показе ленты, сходит за файлом заново. Историю чата при этом не
 * перезапрашиваем: меняется одно сообщение. Если файл снова не скачался,
 * сообщение получит ту же причину, и кнопка останется.
 */
export async function retryMediaDownload(
  queryClient: QueryClient,
  message: IMessageDto
): Promise<void> {
  const patch = await services.messageService.resolveMediaForDisplay(message.chatId, message);
  // Поля показа вложения есть у IMediaItem, а не у самого IMessageDto.
  patchThreadMessage(queryClient, message.chatId, message.id, patch as Partial<IMediaItem>);
}
