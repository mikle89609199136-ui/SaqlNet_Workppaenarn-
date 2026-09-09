import { describe, expect, it } from 'vitest';
import { applyReaction } from './applyReaction';

describe('изменение реакций по нажатию', () => {
  it('ставит новую, когда своей ещё нет', () => {
    const result = applyReaction([{ emoji: '❤️', count: 2, myReaction: false }], '👍');

    expect(result).toEqual([
      { emoji: '❤️', count: 2, myReaction: false },
      { emoji: '👍', count: 1, myReaction: true },
    ]);
  });

  it('присоединяется к чужой реакции, а не заводит вторую строку', () => {
    const result = applyReaction([{ emoji: '👍', count: 3, myReaction: false }], '👍');

    expect(result).toEqual([{ emoji: '👍', count: 4, myReaction: true }]);
  });

  it('снимает свою реакцию повторным нажатием', () => {
    const result = applyReaction([{ emoji: '👍', count: 3, myReaction: true }], '👍');

    expect(result).toEqual([{ emoji: '👍', count: 2, myReaction: false }]);
  });

  it('убирает реакцию из списка, когда её больше никто не ставил', () => {
    const result = applyReaction([{ emoji: '👍', count: 1, myReaction: true }], '👍');

    expect(result).toEqual([]);
  });

  it('заменяет прежнюю реакцию новой', () => {
    /* Без подписки реакция одна: выбор другого эмодзи снимает старую. */
    const result = applyReaction(
      [
        { emoji: '👍', count: 1, myReaction: true },
        { emoji: '❤️', count: 5, myReaction: false },
      ],
      '❤️'
    );

    expect(result).toEqual([{ emoji: '❤️', count: 6, myReaction: true }]);
  });

  it('с подпиской реакции копятся, а не заменяют друг друга', () => {
    const result = applyReaction([{ emoji: '👍', count: 1, myReaction: true }], '❤️', {
      allowMultiple: true,
    });

    expect(result).toEqual([
      { emoji: '👍', count: 1, myReaction: true },
      { emoji: '❤️', count: 1, myReaction: true },
    ]);
  });

  it('работает на сообщении без реакций', () => {
    expect(applyReaction([], '🔥')).toEqual([{ emoji: '🔥', count: 1, myReaction: true }]);
  });
});
