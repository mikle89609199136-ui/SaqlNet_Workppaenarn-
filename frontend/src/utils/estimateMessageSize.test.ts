import { makeMessage } from '@/test/fixtures';
import { describe, expect, it } from 'vitest';
import { estimateMessageItemSize } from './estimateMessageSize';

describe('estimateMessageItemSize', () => {
  it('estimates date divider correctly', () => {
    expect(estimateMessageItemSize({ type: 'date', label: 'Сегодня' })).toBe(44);
  });

  it('estimates short single line text message', () => {
    const message = makeMessage({ content: 'Привет' });
    const size = estimateMessageItemSize({ type: 'message', message });
    expect(size).toBe(49);
  });

  it('estimates multi-line text message with higher height', () => {
    const message = makeMessage({ content: 'Строка 1\nСтрока 2\nСтрока 3' });
    const size = estimateMessageItemSize({ type: 'message', message });
    expect(size).toBeGreaterThan(80);
  });

  it('estimates photo media message', () => {
    const message = makeMessage({
      content: '',
      mediaUrl: 'https://example.com/image.jpg',
      mediaType: 'image',
    });
    const size = estimateMessageItemSize({ type: 'message', message });
    expect(size).toBeGreaterThanOrEqual(240);
  });

  it('estimates message with reply and reactions', () => {
    const message = makeMessage({
      content: 'Ответ на сообщение',
      replyTo: 'msg-1',
      reactions: [{ emoji: '👍', count: 1, myReaction: true }],
    });
    const size = estimateMessageItemSize({ type: 'message', message });
    // Базовый текст (49) + reply (48) + reactions (28) = 125
    expect(size).toBe(125);
  });
});
