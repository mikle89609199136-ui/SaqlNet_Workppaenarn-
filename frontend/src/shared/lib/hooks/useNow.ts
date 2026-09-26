import { useEffect, useState } from 'react';

/**
 * Текущее время, обновляемое раз в intervalMs: для строк вида «5 минут
 * назад», которые иначе застыли бы до следующей перерисовки.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
