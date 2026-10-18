import { describe, expect, it } from 'vitest';
import type { IReactionUpdatedEvent } from '@/types';
import { mergeReactionEvent } from './reactionEvent';

const ME = 'user-1';
const PEER = 'user-2';

const event = (
  actorId: string | undefined,
  change: IReactionUpdatedEvent['change'],
  reactions: IReactionUpdatedEvent['reactions']
) => ({ actorId, change, reactions });

/* В событии нет «моя ли реакция»: рассылка одна на всех (#149). Отметку
   считает получатель (#1063). */
describe('реакции из события reaction_updated', () => {
  it('чужой поставил другую эмодзи — моя остаётся выделенной', () => {
    const got = mergeReactionEvent(
      [{ emoji: '👍', count: 1, myReaction: true }],
      event(PEER, { action: 'added', emoji: '❤️', previousEmoji: null }, [
        { emoji: '👍', count: 1 },
        { emoji: '❤️', count: 1 },
      ]),
      ME
    );

    expect(got).toEqual([
      { emoji: '👍', count: 1, myReaction: true },
      { emoji: '❤️', count: 1, myReaction: false },
    ]);
  });

  it('чужой поставил ту же эмодзи, что у меня, — отметка на месте', () => {
    const got = mergeReactionEvent(
      [{ emoji: '👍', count: 1, myReaction: true }],
      event(PEER, { action: 'added', emoji: '👍', previousEmoji: null }, [
        { emoji: '👍', count: 2 },
      ]),
      ME
    );

    expect(got).toEqual([{ emoji: '👍', count: 2, myReaction: true }]);
  });

  it('чужой снял свою — моя отметка сохранилась, снятая ушла', () => {
    const got = mergeReactionEvent(
      [
        { emoji: '👍', count: 1, myReaction: true },
        { emoji: '❤️', count: 1, myReaction: false },
      ],
      event(PEER, { action: 'removed', emoji: null, previousEmoji: '❤️' }, [
        { emoji: '👍', count: 1 },
      ]),
      ME
    );

    expect(got).toEqual([{ emoji: '👍', count: 1, myReaction: true }]);
  });

  it('у меня реакции нет, чужой поставил — ничего не выделено', () => {
    const got = mergeReactionEvent(
      [],
      event(PEER, { action: 'added', emoji: '❤️', previousEmoji: null }, [
        { emoji: '❤️', count: 1 },
      ]),
      ME
    );

    expect(got).toEqual([{ emoji: '❤️', count: 1, myReaction: false }]);
  });

  it('моё другое устройство заменило 👍 на 😂 — выделена 😂', () => {
    const got = mergeReactionEvent(
      [{ emoji: '👍', count: 1, myReaction: true }],
      event(ME, { action: 'replaced', emoji: '😂', previousEmoji: '👍' }, [
        { emoji: '😂', count: 1 },
      ]),
      ME
    );

    expect(got).toEqual([{ emoji: '😂', count: 1, myReaction: true }]);
  });

  it('моё другое устройство сняло реакцию — ничего не выделено', () => {
    const got = mergeReactionEvent(
      [
        { emoji: '👍', count: 2, myReaction: true },
        { emoji: '❤️', count: 1, myReaction: false },
      ],
      event(ME, { action: 'removed', emoji: null, previousEmoji: '👍' }, [
        { emoji: '👍', count: 1 },
        { emoji: '❤️', count: 1 },
      ]),
      ME
    );

    expect(got.every((reaction) => !reaction.myReaction)).toBe(true);
  });

  it('пустой список в событии — пустой результат', () => {
    expect(
      mergeReactionEvent(
        [{ emoji: '👍', count: 1, myReaction: true }],
        event(PEER, { action: 'removed', emoji: null, previousEmoji: '👍' }, []),
        ME
      )
    ).toEqual([]);
  });

  it('событие без автора и изменения — отметки из кеша', () => {
    const got = mergeReactionEvent(
      [{ emoji: '👍', count: 1, myReaction: true }],
      event(undefined, undefined, [
        { emoji: '👍', count: 1 },
        { emoji: '❤️', count: 1 },
      ]),
      ME
    );

    expect(got).toEqual([
      { emoji: '👍', count: 1, myReaction: true },
      { emoji: '❤️', count: 1, myReaction: false },
    ]);
  });
});
