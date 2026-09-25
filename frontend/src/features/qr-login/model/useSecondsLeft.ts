import { useEffect, useState } from 'react';

/** Сколько целых секунд осталось до `until`; `null` — отсчёта нет. */
export function useSecondsLeft(until: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return undefined;
    const tick = () => setNow(Date.now());
    // Первый тик сразу: `now` мог застыть на прежнем отсчёте.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [until]);

  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
}
