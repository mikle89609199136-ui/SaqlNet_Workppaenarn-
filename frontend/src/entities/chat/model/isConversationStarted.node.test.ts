import { describe, expect, it } from 'vitest';
import type { IChatDto } from './types';
import { isConversationStarted } from './isConversationStarted';

function makeChat(overrides: Partial<IChatDto>): IChatDto {
  return { id: 'chat-1', type: 'private', title: 'Чат', ...overrides } as IChatDto;
}

describe('началась ли переписка', () => {
  it('личный чат без сообщений — ещё не переписка', () => {
    /* Он заводится, когда человека открыли из поиска: без этого правила
       список пополнялся бы каждым, к кому заглянули. */
    expect(isConversationStarted(makeChat({ type: 'private' }))).toBe(false);
  });

  it('личный чат с первым сообщением — уже переписка', () => {
    const chat = makeChat({ type: 'private', lastMessage: { content: 'привет' } as never });

    expect(isConversationStarted(chat)).toBe(true);
  });

  it('пустая группа остаётся: её создали, а не заглянули', () => {
    expect(isConversationStarted(makeChat({ type: 'group' }))).toBe(true);
  });
});
