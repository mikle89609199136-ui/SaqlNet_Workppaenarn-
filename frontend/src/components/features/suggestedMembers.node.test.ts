import { describe, expect, it } from 'vitest';
import type { IChatDto } from '@/types';
import { suggestedMembers } from './suggestedMembers';

function chat(overrides: Partial<IChatDto>): IChatDto {
  return { id: 'chat-1', type: 'private', title: 'Собеседник', ...overrides } as IChatDto;
}

describe('кого предложить в новую группу', () => {
  it('should offer people you already talk to', async () => {
    // Группу почти всегда собирают из тех, с кем и так переписываются:
    // заставлять искать их по имени — лишняя работа.
    const suggested = suggestedMembers(
      [
        chat({ id: 'c1', peerId: 'boris', title: 'Борис' }),
        chat({ id: 'c2', peerId: 'carol', title: 'Кэрол' }),
      ],
      'alice'
    );

    expect(suggested.map((user) => user.id)).toEqual(['boris', 'carol']);
    expect(suggested[0].firstName).toBe('Борис');
  });

  it('should skip group chats', () => {
    // Участники группы в списке чатов не видны, а тянуть состав каждой
    // ради подсказки — несколько запросов ради догадки.
    const suggested = suggestedMembers(
      [chat({ id: 'c1', type: 'group', title: 'Рабочий чат', peerId: undefined })],
      'alice'
    );

    expect(suggested).toEqual([]);
  });

  it('should skip a chat without a peer', () => {
    const suggested = suggestedMembers([chat({ id: 'c1', peerId: undefined })], 'alice');

    expect(suggested).toEqual([]);
  });

  it('should not offer you to yourself', () => {
    const suggested = suggestedMembers([chat({ id: 'c1', peerId: 'alice' })], 'alice');

    expect(suggested).toEqual([]);
  });

  it('should mention a person once', () => {
    // С одним человеком может быть заведено несколько записей чата.
    const suggested = suggestedMembers(
      [chat({ id: 'c1', peerId: 'boris' }), chat({ id: 'c2', peerId: 'boris' })],
      'alice'
    );

    expect(suggested).toHaveLength(1);
  });

  it('should keep the avatar when the chat has one', () => {
    const suggested = suggestedMembers(
      [chat({ id: 'c1', peerId: 'boris', avatarUrl: 'data:image/jpeg;base64,AAAA' })],
      'alice'
    );

    expect(suggested[0].avatarUrl).toBe('data:image/jpeg;base64,AAAA');
  });
});
