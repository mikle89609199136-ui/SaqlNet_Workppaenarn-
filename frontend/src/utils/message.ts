import type { IMessageDto, TMessagesList } from '@/types';

export const hasMessageMedia = (msg: IMessageDto) => !!(msg.mediaUrl || msg.mediaUnavailable);

export const formatMessageTime = (value: Date | string) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
};

export function getMessagePreview(message: IMessageDto | null) {
  if (!message) return '';
  return String(message.content || '').slice(0, 64);
}

export function appendUniqueMessage(items: TMessagesList, nextMessage: IMessageDto) {
  if (items.some((message) => message.id === nextMessage.id)) return items;
  return [...items, nextMessage];
}
