import { formatLastSeen, formatLastSeenApprox } from './formatLastSeen';

/**
 * Генерирует подзаголовок для чата (статус онлайн / печатает / последнее посещение).
 *
 * now — текущее время: строка вида «5 минут назад» пересчитывается от него,
 * поэтому вызывающий обновляет его по таймеру (useNow).
 *
 * onlineCount — сколько участников группы в сети, если известно: тогда
 * подзаголовок как в макете, «5 участников, 2 в сети» (#822).
 */
export const getChatSubtitle = (chat, typingUserId, t, now = new Date(), onlineCount) => {
  if (typingUserId) return t('typing', 'печатает...');
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
