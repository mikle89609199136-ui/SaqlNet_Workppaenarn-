export type TTimestampedItem =
  | { createdAt: Date | string | number }
  | { pinnedAt: Date | string | number };

export function sortMessagesChronologically<T extends TTimestampedItem>(messages: T[]): T[] {
  return [...messages].sort((left, right) => messageTime(left) - messageTime(right));
}

function messageTime(message: TTimestampedItem): number {
  const value = 'createdAt' in message ? message.createdAt : message.pinnedAt;
  const time = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}
