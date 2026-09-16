import { describe, expect, it } from 'vitest';
import type { IChatDto } from '@/types';
import { chatsQuery } from './chatsQuery';

function makeChat(overrides: Partial<IChatDto>): IChatDto {
  return {
    id: 'chat-1',
    type: 'private',
    title: 'Чат',
    lastMessage: undefined,
    lastMessageAt: undefined,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as IChatDto;
}

const select = chatsQuery().select!;

describe('порядок списка чатов', () => {
  it('сверху те, где писали недавно', () => {
    const older = makeChat({
      id: 'older',
      lastMessage: { content: 'раньше' } as never,
      lastMessageAt: new Date('2026-09-01T10:00:00Z'),
    });
    const newer = makeChat({
      id: 'newer',
      lastMessage: { content: 'позже' } as never,
      lastMessageAt: new Date('2026-09-03T10:00:00Z'),
    });

    expect(select([older, newer]).map((chat) => chat.id)).toEqual(['newer', 'older']);
  });
});
