import { describe, expect, it } from 'vitest';
import { makeChat } from '@/test/fixtures';
import { applyChatListReceipt } from './chatListReceipts';
import type { IChatDto } from './types';

const me = 'user-1';
const peer = 'user-2';
const at = '2026-09-29T12:05:00.000Z';

function chatWithLast(senderId: string, lastMessageAt: string, extra = {}): IChatDto {
  return makeChat({
    id: 'chat-1',
    lastMessageAt: lastMessageAt as unknown as Date,
    lastMessage: {
      id: 'm-1',
      content: 'привет',
      type: 'text',
      senderId,
      senderName: 'Я',
      reactions: [],
      ...extra,
    },
  });
}

describe('галочки последнего сообщения в списке чатов (#657)', () => {
  it('своё последнее до границы — прочитано и доставлено', () => {
    const chats = [chatWithLast(me, '2026-09-29 12:00:00.123456+00')];

    const [chat] = applyChatListReceipt(chats, {
      chatId: 'chat-1',
      userId: peer,
      kind: 'read',
      upTo: '2026-09-29T12:00:00.123Z',
      at,
    });

    expect(chat.lastMessage).toMatchObject({ readAt: at, deliveredAt: at });
  });

  it('новее границы, чужое последнее и другой чат — без изменений', () => {
    const chats = [
      chatWithLast(me, '2026-09-29T12:10:00.000Z'),
      { ...chatWithLast(peer, '2026-09-29T11:00:00.000Z'), id: 'chat-2' },
    ];
    const event = {
      chatId: 'chat-1',
      userId: peer,
      kind: 'delivered' as const,
      upTo: '2026-09-29T12:00:00.000Z',
      at,
    };

    expect(applyChatListReceipt(chats, event)).toBe(chats);
    expect(applyChatListReceipt(chats, { ...event, chatId: 'chat-2' })).toBe(chats);
  });
});
