import type { TReactionsList } from './types';

/**
 * Как изменится набор реакций от нажатия на эмодзи.
 *
 * Считается на клиенте, чтобы показать результат сразу, не дожидаясь
 * сервера: реакция — жест мгновенный, и задержка в полсекунды на ней
 * заметна сильнее, чем где-либо ещё.
 *
 * Правила те же, что у сервера: своя реакция снимается повторным
 * нажатием. Отличие одно — без подписки реакция может быть только одна,
 * поэтому выбор другого эмодзи снимает прежний.
 */
export function applyReaction(
  reactions: TReactionsList,
  emoji: string,
  { allowMultiple = false } = {}
): TReactionsList {
  const mine = reactions.find((reaction) => reaction.myReaction);

  const withoutOne = (list: TReactionsList, target: string): TReactionsList =>
    list
      .map((reaction) =>
        reaction.emoji === target
          ? { ...reaction, count: reaction.count - 1, myReaction: false }
          : reaction
      )
      // Реакция, которую больше никто не ставил, из списка уходит совсем.
      .filter((reaction) => reaction.count > 0);

  // Нажали на свою же — снимаем.
  if (mine?.emoji === emoji) return withoutOne(reactions, emoji);

  const base = mine && !allowMultiple ? withoutOne(reactions, mine.emoji) : reactions;
  const existing = base.find((reaction) => reaction.emoji === emoji);

  if (existing) {
    return base.map((reaction) =>
      reaction.emoji === emoji
        ? { ...reaction, count: reaction.count + 1, myReaction: true }
        : reaction
    );
  }

  return [...base, { emoji, count: 1, myReaction: true }];
}
