import i18n from 'i18next';
import type { TFunction } from 'i18next';

/**
 * «Был(а) …» — последняя активность собеседника (#792).
 *
 * Точное время — относительно, в языке приложения: «только что», «N минут
 * назад», «в 12:30», «вчера в 12:30», «25 сентября в 12:30», с годом — если
 * не в этом году. Когда время скрыто, сервер присылает промежуток вместо него
 * (#791): «недавно», «на этой неделе», «в этом месяце», «давно».
 */

/** Промежуток вместо скрытого времени — как его присылает сервер. */
export type TLastSeenApprox = 'recently' | 'within_week' | 'within_month' | 'long_ago';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface IFormatLastSeenOptions {
  /** Текущее время: подставляется в тестах и при обновлении строки по таймеру. */
  now?: Date;
  /** Язык дат; по умолчанию — язык приложения. */
  locale?: string;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

export const formatLastSeen = (
  value: string | Date,
  t: TFunction,
  { now = new Date(), locale = i18n.language || 'ru' }: IFormatLastSeenOptions = {}
): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return formatLastSeenApprox('recently', t);

  // Часы клиента и сервера расходятся: «из будущего» — тоже «только что».
  const age = now.getTime() - date.getTime();
  if (age < MINUTE) return t('lastSeenJustNow', 'был(а) только что');
  if (age < HOUR) {
    const count = Math.floor(age / MINUTE);
    return t('lastSeenMinutesAgo', { count, defaultValue: 'был(а) {{count}} мин. назад' });
  }

  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  if (isSameDay(date, now)) return t('lastSeenToday', { time, defaultValue: 'был(а) в {{time}}' });

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return t('lastSeenYesterday', { time, defaultValue: 'был(а) вчера в {{time}}' });
  }

  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
  return t('lastSeenOnDate', { date: day, time, defaultValue: 'был(а) {{date}} в {{time}}' });
};

export const formatLastSeenApprox = (approx: TLastSeenApprox | string, t: TFunction): string => {
  switch (approx) {
    case 'within_week':
      return t('lastSeenWithinWeek', 'был(а) на этой неделе');
    case 'within_month':
      return t('lastSeenWithinMonth', 'был(а) в этом месяце');
    case 'long_ago':
      return t('lastSeenLongAgo', 'был(а) давно');
    default:
      return t('lastSeenRecently', 'был(а) недавно');
  }
};
