import type { IMessageDto } from '@/types';

export type TEstimatableFeedItem =
  | { type: 'date'; label?: string }
  | { type: 'message'; message: IMessageDto };

const CHARS_PER_LINE = 42;
const LINE_HEIGHT_PX = 20;
const BASE_BUBBLE_PADDING_PX = 29;
const DATE_DIVIDER_HEIGHT_PX = 44;
const REPLY_PREVIEW_HEIGHT_PX = 48;
const REACTIONS_ROW_HEIGHT_PX = 28;
const MEDIA_PHOTO_HEIGHT_PX = 240;
const MEDIA_AUDIO_HEIGHT_PX = 64;
const CALL_MESSAGE_HEIGHT_PX = 47;
const SENDER_STATUS_HEIGHT_PX = 18;
const MIN_BUBBLE_HEIGHT_PX = 45;
const MAX_BUBBLE_HEIGHT_PX = 1200;

/**
 * Оценивает высоту элемента ленты сообщений до первого рендера в DOM,
 * чтобы предотвратить скачки скролла при первоначальной виртуализации.
 */
export function estimateMessageItemSize(item?: TEstimatableFeedItem | null): number {
  if (!item) return MIN_BUBBLE_HEIGHT_PX;

  if (item.type === 'date') {
    return DATE_DIVIDER_HEIGHT_PX;
  }

  const { message } = item;
  if (message.type === 'call') {
    return CALL_MESSAGE_HEIGHT_PX;
  }

  let height = 0;

  // 1. Медиаконтент
  const actualType = message.mediaType || message.type;
  if (actualType === 'audio' || actualType === 'voice') {
    height += MEDIA_AUDIO_HEIGHT_PX;
  } else if (message.mediaUrl) {
    height += MEDIA_PHOTO_HEIGHT_PX;
  }

  // 2. Цитата (ответ на другое сообщение)
  if (message.replyTo || message.replyToMessageId) {
    height += REPLY_PREVIEW_HEIGHT_PX;
  }

  // 3. Текстовое содержимое
  const text = message.content?.trim() || '';
  if (text) {
    const lines = text.split('\n');
    let lineCount = 0;
    for (const line of lines) {
      lineCount += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
    }
    height += lineCount * LINE_HEIGHT_PX + BASE_BUBBLE_PADDING_PX;
  } else if (!height) {
    height = MIN_BUBBLE_HEIGHT_PX;
  }

  // 4. Реакции под сообщением
  if (message.reactions && message.reactions.length > 0) {
    height += REACTIONS_ROW_HEIGHT_PX;
  }

  // 5. Статус отправителя
  if (message.senderStatusEmoji) {
    height += SENDER_STATUS_HEIGHT_PX;
  }

  return Math.max(MIN_BUBBLE_HEIGHT_PX, Math.min(height, MAX_BUBBLE_HEIGHT_PX));
}
