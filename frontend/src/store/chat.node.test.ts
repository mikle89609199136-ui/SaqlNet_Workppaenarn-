import { beforeEach, describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { useChatStore } from './chat';

describe('отметка о прочтении в сторе', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState(), true);
  });

  it('should mark the very first message of the thread', () => {
    // findIndex возвращает 0 для первого элемента, и проверка на ложность
    // отсекала именно его: самое старое сообщение не помечалось никогда.
    const [first, second] = [makeMessage(), makeMessage()];
    useChatStore.setState({ messages: [first, second] });

    useChatStore.getState().markAsRead(first.id);

    expect(useChatStore.getState().messages[0].isRead).toBe(true);
  });

  it('should mark a message in the middle of the thread', () => {
    const [first, second, third] = [makeMessage(), makeMessage(), makeMessage()];
    useChatStore.setState({ messages: [first, second, third] });

    useChatStore.getState().markAsRead(second.id);

    const messages = useChatStore.getState().messages;
    expect(messages[1].isRead).toBe(true);
    expect(messages[0].isRead).toBeFalsy();
    expect(messages[2].isRead).toBeFalsy();
  });

  it('should leave the thread untouched for an unknown message', () => {
    // findIndex вернёт -1, и запись по такому индексу портила массив.
    const messages = [makeMessage(), makeMessage()];
    useChatStore.setState({ messages });

    useChatStore.getState().markAsRead('сообщения-с-таким-id-нет');

    const next = useChatStore.getState().messages;
    expect(next).toHaveLength(2);
    expect(next.some((message) => message.isRead)).toBe(false);
    // Длина при записи по индексу -1 не меняется, поэтому проверяем сам факт
    // появления такого свойства у массива.
    expect(Object.hasOwn(next, -1)).toBe(false);
  });

  it('should replace the array so subscribers re-render', () => {
    // Раньше массив менялся на месте и уходил в set по той же ссылке —
    // Zustand сравнивает по ссылке, поэтому подписчики ничего не замечали.
    const messages = [makeMessage()];
    useChatStore.setState({ messages });

    useChatStore.getState().markAsRead(messages[0].id);

    expect(useChatStore.getState().messages).not.toBe(messages);
  });
});
