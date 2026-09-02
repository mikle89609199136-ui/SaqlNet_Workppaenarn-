import type { IChatDto } from '@/types';
import { describe, expect, it } from 'vitest';
import { suggestedMembers } from './suggestedMembers';

describe('suggestedMembers', () => {
  it('берёт собеседников только из приватных чатов', () => {
    const chats: IChatDto[] = [
      {
        id: '1',
        type: 'private',
        title: 'Анна',
        peerId: 'user-anna',
        unreadCount: 0,
      } as IChatDto,
      {
        id: '2',
        type: 'group',
        title: 'Команда',
        peerId: null,
        unreadCount: 0,
      } as IChatDto,
    ];

    const res = suggestedMembers(chats, 'my-id');
    expect(res).toEqual([{ id: 'user-anna', username: 'Анна', avatarUrl: null }]);
  });

  it('не предлагает самого себя (чат «Избранное»)', () => {
    const chats: IChatDto[] = [
      {
        id: '1',
        type: 'private',
        title: 'Избранное',
        peerId: 'my-id',
        unreadCount: 0,
      } as IChatDto,
    ];

    expect(suggestedMembers(chats, 'my-id')).toEqual([]);
  });

  it('убирает дубликаты, если с одним человеком несколько строк', () => {
    const chats: IChatDto[] = [
      {
        id: '1',
        type: 'private',
        title: 'Иван',
        peerId: 'user-ivan',
        unreadCount: 0,
      } as IChatDto,
      {
        id: '2',
        type: 'private',
        title: 'Иван старый',
        peerId: 'user-ivan',
        unreadCount: 0,
      } as IChatDto,
    ];

    const res = suggestedMembers(chats, 'my-id');
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('user-ivan');
  });

  it('сохраняет порядок из списка чатов (недавние сверху)', () => {
    const chats: IChatDto[] = [
      {
        id: '1',
        type: 'private',
        title: 'Борис',
        peerId: 'user-boris',
        unreadCount: 0,
      } as IChatDto,
      {
        id: '2',
        type: 'private',
        title: 'Анна',
        peerId: 'user-anna',
        unreadCount: 0,
      } as IChatDto,
    ];

    const res = suggestedMembers(chats, 'my-id');
    expect(res.map((u) => u.id)).toEqual(['user-boris', 'user-anna']);
  });
});
