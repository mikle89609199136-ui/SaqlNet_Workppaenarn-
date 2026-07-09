export function formatTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(date));
}

export function formatDate(date) {
  const value = toDate(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(value, today)) return 'Сегодня';
  if (isSameDay(value, yesterday)) return 'Вчера';

  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(value);
}

export function isSameDay(firstDate, secondDate) {
  const first = toDate(firstDate);
  const second = toDate(secondDate);

  return (
    first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate()
  );
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}
