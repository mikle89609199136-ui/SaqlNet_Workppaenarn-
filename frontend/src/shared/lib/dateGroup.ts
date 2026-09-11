import i18n from 'i18next';

/**
 * Безопасно парсит дату из строки, числа или Date.
 */
function toValidDate(input?: string | number | Date): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Проверяет, относятся ли две даты к разным календарным дням.
 */
export function isDifferentDay(
  date1?: string | number | Date,
  date2?: string | number | Date
): boolean {
  if (!date1 || !date2) return true;
  const d1 = toValidDate(date1);
  const d2 = toValidDate(date2);
  if (!d1 || !d2) return true;

  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
}

/**
 * Форматирует дату для плавающего разделителя сообщений («Сегодня», «Вчера», «12 мая»).
 */
export function formatDateDivider(
  input: string | number | Date,
  t: (key: string, fallback: string) => string
): string {
  const date = toValidDate(input);
  if (!date) return '';

  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();

  const isToday =
    date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && isSameYear;

  if (isToday) {
    return t('today', 'Сегодня');
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return t('yesterday', 'Вчера');
  }

  const locale = i18n.language || 'ru-RU';
  try {
    return date.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: isSameYear ? undefined : 'numeric',
    });
  } catch {
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: isSameYear ? undefined : 'numeric',
    });
  }
}
