import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypingStore } from './typingStore';

const typers = (chatId: string) => useTypingStore.getState().typingByChat[chatId];
const { setTyping, clearTyping } = useTypingStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Стор общий для всех тестов (isolate: false): снимаем всех и таймеры.
  Object.keys(useTypingStore.getState().typingByChat).forEach((chatId) => clearTyping(chatId));
  vi.useRealTimers();
});

describe('кто печатает (#837)', () => {
  it('держит нескольких печатающих в порядке, в каком начали', () => {
    setTyping('group', 'igor', 'Игорь');
    setTyping('group', 'masha', 'Маша');

    expect(typers('group')).toEqual([
      { userId: 'igor', firstName: 'Игорь' },
      { userId: 'masha', firstName: 'Маша' },
    ]);
  });

  it('у каждого свой таймер: замолчал один — пропадает только он', () => {
    setTyping('group', 'igor');
    vi.advanceTimersByTime(2000);
    setTyping('group', 'masha');

    vi.advanceTimersByTime(1500);
    expect(typers('group')).toEqual([{ userId: 'masha', firstName: undefined }]);

    vi.advanceTimersByTime(1500);
    expect(typers('group')).toBeUndefined();
  });

  it('повторное событие продлевает таймер и не пересоздаёт список', () => {
    setTyping('group', 'igor', 'Игорь');
    const before = typers('group');

    vi.advanceTimersByTime(2500);
    setTyping('group', 'igor', 'Игорь');
    // Та же ссылка — строка списка чатов не перерисовывается.
    expect(typers('group')).toBe(before);

    vi.advanceTimersByTime(2500);
    expect(typers('group')).toBe(before);
  });

  it('имя из более позднего события подхватывается', () => {
    setTyping('group', 'igor');
    setTyping('group', 'igor', 'Игорь');

    expect(typers('group')).toEqual([{ userId: 'igor', firstName: 'Игорь' }]);
  });

  it('снимает одного — например, когда от него пришло сообщение', () => {
    setTyping('group', 'igor');
    setTyping('group', 'masha');

    clearTyping('group', 'igor');

    expect(typers('group')).toEqual([{ userId: 'masha', firstName: undefined }]);
    // Таймер снятого остановлен: его срабатывание не тронет остальных.
    vi.advanceTimersByTime(2999);
    expect(typers('group')).toHaveLength(1);
  });

  it('чужой чат при изменении не трогается', () => {
    setTyping('a', 'igor');
    const other = typers('a');

    setTyping('b', 'masha');
    clearTyping('b', 'masha');

    expect(typers('a')).toBe(other);
  });
});
