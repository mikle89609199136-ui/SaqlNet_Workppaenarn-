import type { IReactionUpdatedEvent } from '@/types';
import type { TReactionsList } from './types';

/**
 * Реакции сообщения после события `reaction_updated` (#1063).
 *
 * Счётчики и состав — из события, а «моя ли это реакция» сервер не
 * присылает: рассылка одна на всех, флаг у каждого свой (#149). Прежде
 * клиент клал массив из события как есть, и после чужого лайка моя
 * реакция переставала быть выделенной.
 *
 * - Действие другого человека мою реакцию не меняет: отметка остаётся на
 *   той эмодзи, на которой была.
 * - Моё действие — с другого устройства или эхо, пришедшее позже ответа, —
 *   выделяет то, что я поставил, или ничего, если снял: у человека одна
 *   реакция на сообщение.
 * - Без автора и изменения в событии — как чужое.
 */
export function mergeReactionEvent(
  cached: TReactionsList | undefined,
  event: Pick<IReactionUpdatedEvent, 'actorId' | 'change' | 'reactions'>,
  currentUserId: string | undefined
): TReactionsList {
  const mine = Boolean(event.actorId && currentUserId && event.actorId === currentUserId);

  if (mine && event.change) {
    const { action, emoji } = event.change;
    return (event.reactions ?? []).map((reaction) => ({
      ...reaction,
      myReaction: action !== 'removed' && reaction.emoji === emoji,
    }));
  }

  const markedBefore = new Set(
    (cached ?? []).filter((reaction) => reaction.myReaction).map((reaction) => reaction.emoji)
  );
  return (event.reactions ?? []).map((reaction) => ({
    ...reaction,
    myReaction: markedBefore.has(reaction.emoji),
  }));
}
