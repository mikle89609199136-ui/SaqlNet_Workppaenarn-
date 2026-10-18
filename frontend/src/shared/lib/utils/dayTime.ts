import i18n from 'i18next';

export interface IDayTimeOptions {
  /** Текущее время: подставляется в тестах. */
  now?: Date;
  /** Язык дат; по умолчанию — язык приложения. */
  locale?: string;
}

/**
 * Когда это было — для строк вида «… сегодня в 21:05», «… вчера в 18:40»,
 * «… 25 сентября в 12:30». Слова вокруг подставляет тот, кто знает, о чём
 * речь: прочтение (#657) или правка сообщения (#1066).
 */
export interface IDayTime {
  day: 'today' | 'yesterday' | 'date';
  /** Часы и минуты в часовом поясе человека. */
  time: string;
  /** «25 сентября», с годом — если не этот. Для today и yesterday не нужен. */
  date: string;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

export function describeDayTime(
  date: Date,
  { now = new Date(), locale = i18n.language || 'ru' }: IDayTimeOptions = {}
): IDayTime {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);

  if (isSameDay(date, now)) return { day: 'today', time, date: day };

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return { day: 'yesterday', time, date: day };

  return { day: 'date', time, date: day };
}
