import { formatLastSeen, formatLastSeenApprox } from '@/shared/lib';

/**
 * Генерирует подзаголовок для чата (статус онлайн / печатает / последнее посещение).
 *
 * Живёт в сущности чата, а не в shared: знает про группы, участников и
 * присутствие собеседника. Кто печатает, приходит готовой подписью —
 * её собирает useTypingLabel (#837).
 *
 * now — текущее время: строка вида «5 минут назад» пересчитывается от него,
 * поэтому вызывающий обновляет его по таймеру (useNow).
 *
 * onlineCount — сколько участников группы в сети, если известно: тогда
 * подзаголовок как в макете, «5 участников, 2 в сети» (#822).
 */
export const getChatSubtitle = (
  chat,
  typingLabel,
  t,
  now = new Date(),
  onlineCount = undefined
) => {
  if (typingLabel) return typingLabel;
  // У «Избранного» собеседника нет — и «был давно» про себя ни к чему (#1075).
  if (chat?.type === 'self') return '';
  if (chat?.type === 'group') {
    if (!chat.memberCount) return t('groupChat', 'Группа');
    const members = t('membersCount', {
      count: chat.memberCount,
      defaultValue: '{{count}} участников',
    });
    return typeof onlineCount === 'number' && onlineCount > 0
      ? `${members}, ${t('onlineCount', { count: onlineCount, defaultValue: '{{count}} в сети' })}`
      : members;
  }
  if (chat?.peerIsOnline) return t('online', 'онлайн');
  if (chat?.peerLastSeen) return formatLastSeen(chat.peerLastSeen, t, { now });
  // Время скрыто — сервер прислал промежуток (#791). Нет ни того, ни
  // другого — человек ни разу не был в сети.
  return formatLastSeenApprox(chat?.peerLastSeenApprox ?? 'long_ago', t);
};
