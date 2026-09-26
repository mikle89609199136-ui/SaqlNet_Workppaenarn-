import { formatLastSeen, formatLastSeenApprox } from './formatLastSeen';

/**
 * Генерирует подзаголовок для чата (статус онлайн / печатает / последнее посещение).
 *
 * now — текущее время: строка вида «5 минут назад» пересчитывается от него,
 * поэтому вызывающий обновляет его по таймеру (useNow).
 */
export const getChatSubtitle = (chat, typingUserId, t, now = new Date()) => {
  if (typingUserId) return t('typing', 'печатает...');
  if (chat?.type === 'group') return t('groupChat', 'Группа');
  if (chat?.peerIsOnline) return t('online', 'онлайн');
  if (chat?.peerLastSeen) return formatLastSeen(chat.peerLastSeen, t, { now });
  // Время скрыто — сервер прислал промежуток (#791). Нет ни того, ни
  // другого — человек ни разу не был в сети.
  return formatLastSeenApprox(chat?.peerLastSeenApprox ?? 'long_ago', t);
};
