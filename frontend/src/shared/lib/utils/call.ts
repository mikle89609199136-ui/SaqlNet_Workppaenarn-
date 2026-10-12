import type { TFunction } from 'i18next';

export const parseCallContent = (content: string) => {
  if (!content || typeof content !== 'string') return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
};

/** Длительность звонка: «1:05» или, если меньше минуты, «28 сек» на языке интерфейса. */
export const formatCallDuration = (seconds: number, t: TFunction) => {
  const total = Number(seconds) || 0;
  if (total <= 0) return '';
  const mins = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return mins
    ? `${mins}:${rest}`
    : t('call.durationSeconds', { seconds: total % 60, defaultValue: '{{seconds}} сек' });
};

/**
 * Превью звонка в списке чатов и в уведомлении: «Звонок завершен · 1:05».
 *
 * Собирается там, где известен язык, — раньше это делал сервис расшифровки
 * превью, и строка оставалась русской в английском интерфейсе.
 */
export function formatCallPreview(content: string | null | undefined, t: TFunction): string {
  const ended = t('callEnded', 'Звонок завершен');
  const duration = formatCallDuration(Number(parseCallContent(content ?? '').duration) || 0, t);
  return duration ? `${ended} · ${duration}` : ended;
}
