import { describe, expect, it } from 'vitest';
import type { IChatDto } from './types';
import { chatsQuery } from './chatsQuery';

function makeChat(overrides: Partial<IChatDto>): IChatDto {
  return {
    id: 'chat-1',
    type: 'private',
    title: 'Чат',
    isPinned: false,
    lastMessage: { content: 'привет' },
    createdAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as IChatDto;
}

const select = chatsQuery().select!;

describe('закреплённые чаты в списке', () => {
  it('поднимает закреплённый над свежими', () => {
    /* Сервер отдаёт их первыми и сам, но клиент пересортировывал всё по
       времени и это затирал. */
    const fresh = makeChat({
      id: 'fresh',
      lastMessageAt: new Date('2026-09-03T12:00:00Z'),
    });
    const pinned = makeChat({
      id: 'pinned',
      isPinned: true,
      lastMessageAt: new Date('2026-08-01T09:00:00Z'),
    });

    expect(select([fresh, pinned]).map((chat) => chat.id)).toEqual(['pinned', 'fresh']);
  });

  it('среди закреплённых порядок прежний — по времени', () => {
    const older = makeChat({
      id: 'older',
      isPinned: true,
      lastMessageAt: new Date('2026-09-01T10:00:00Z'),
    });
    const newer = makeChat({
      id: 'newer',
      isPinned: true,
      lastMessageAt: new Date('2026-09-03T10:00:00Z'),
    });

    expect(select([older, newer]).map((chat) => chat.id)).toEqual(['newer', 'older']);
  });

  it('архивные запрашиваются отдельным ключом', () => {
    expect(chatsQuery({ archived: true }).queryKey).not.toEqual(chatsQuery().queryKey);
  });
});
