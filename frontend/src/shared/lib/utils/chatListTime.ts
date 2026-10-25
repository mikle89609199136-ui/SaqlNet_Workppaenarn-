/**
 * Отметка времени в строке списка чатов.
 *
 * Отдельно от `formatMessageTime`: в ленте сообщений видно разделители
 * дней, поэтому там достаточно часов и минут. В списке разделителей нет,
 * и сообщение недельной давности с одним лишь временем неотличимо от
 * сегодняшнего.
 *
 * Названия дней и слово «вчера» берутся у `Intl`, а не из словаря:
 * перевод сорока с лишним языков уже сделан в браузере.
 */

const WEEK = 7;

function startOfDay(value: Date): number {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export function formatChatListTime(
  value: Date | string | null | undefined,
  locale?: string,
  now: Date = new Date()
): string {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  /* Отрицательное значение — время из будущего: часы разошлись на
     клиенте или на сервере. Показывается как сегодняшнее, потому что
     «через два дня» в списке чатов выглядит поломкой. */
  if (days <= 0) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  if (days === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day');
  }

  if (days < WEEK) {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  }

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
}

/**
 * Время звонка в истории (#1074): сегодняшний — как в списке чатов, часы
 * и минуты; прошлые — день и время: «вчера, 09:07», «пн, 14:05»,
 * «12.10.26, 14:05». В списке чатов одного дня достаточно, а в журнале
 * звонков важно, когда именно звонили.
 */
export function formatCallTime(
  value: Date | string | null | undefined,
  locale?: string,
  now: Date = new Date()
): string {
  const day = formatChatListTime(value, locale, now);
  if (!day || !value) return day;

  const date = value instanceof Date ? value : new Date(value);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  return day === time ? day : `${day}, ${time}`;
}
