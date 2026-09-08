import type { IMessageDto, IPinnedDto } from '@/types';

type TTimestamped = IMessageDto | IPinnedDto;

export function sortMessagesChronologically<T extends TTimestamped>(messages: T[]): T[] {
  return [...messages].sort((left, right) => messageTime(left) - messageTime(right));
}

function messageTime(message: IMessageDto | IPinnedDto): number {
  const value = 'createdAt' in message ? message.createdAt : message.pinnedAt;
  const time = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}
