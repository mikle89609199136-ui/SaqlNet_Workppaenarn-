import { describe, expect, it } from 'vitest';
import { chatKeys } from './chatKeys';
import { userKeys } from '@/entities/user';

describe('ключи запросов', () => {
  it('should nest chat data under the chat key', () => {
    // Вложенность позволяет сбросить всё, что относится к чату, одним
    // вызовом по префиксу — это понадобится при смене ключей шифрования.
    const chatId = 'chat-1';

    expect(chatKeys.messages(chatId).slice(0, 2)).toEqual(chatKeys.detail(chatId));
    expect(chatKeys.pins(chatId).slice(0, 2)).toEqual(chatKeys.detail(chatId));
    expect(chatKeys.detail(chatId).slice(0, 1)).toEqual(chatKeys.all);
  });

  it('should keep different chats apart', () => {
    expect(chatKeys.messages('chat-1')).not.toEqual(chatKeys.messages('chat-2'));
  });

  it('should be stable between calls', () => {
    // Нестабильный ключ означал бы промах мимо кеша при каждом рендере.
    expect(chatKeys.messages('chat-1')).toEqual(chatKeys.messages('chat-1'));
    expect(userKeys.me()).toEqual(userKeys.me());
  });

  it('should not mix chat and user namespaces', () => {
    expect(chatKeys.all[0]).not.toBe(userKeys.all[0]);
  });
});
