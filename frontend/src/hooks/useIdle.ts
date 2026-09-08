import { useCallback, useEffect, useRef, useState } from 'react';

interface UseIdleOptions {
  enabled?: boolean;
  timeoutMs?: number;
}

/**
 * Бездействие: ничего не происходит дольше заданного времени.
 *
 * Наружу отдаётся `enabled && isIdle`, а не одно хранимое значение:
 * иначе при выключении пришлось бы сбрасывать состояние вручную, прямо в
 * эффекте, — а это лишний рендер сразу после первого и предупреждение
 * React про каскад. Производное вычисляется, а не хранится.
 */
export const useIdle = ({ enabled = true, timeoutMs = 2000 }: UseIdleOptions = {}) => {
  const [idle, setIdle] = useState(false);
  const idleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);

  /* Запись в ссылку — в эффекте: во время отрисовки менять их нельзя,
     React вправе отбросить рендер и начать заново. */
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const resetIdle = useCallback(() => {
    setIdle(false);
    if (idleTimeout.current) clearTimeout(idleTimeout.current);
    if (enabledRef.current) {
      idleTimeout.current = setTimeout(() => setIdle(true), timeoutMs);
    }
  }, [timeoutMs]);

  const hideControls = useCallback(() => {
    if (idleTimeout.current) clearTimeout(idleTimeout.current);
    setIdle(true);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
      return undefined;
    }

    /* Таймер ставится напрямую, без `resetIdle`: тот заодно вызывает
       `setIdle(false)`, а синхронное обновление состояния в эффекте
       заставляет React рисовать дважды подряд. Здесь достаточно завести
       отсчёт — состояние меняется уже по событию или по таймеру. */
    const schedule = () => {
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
      idleTimeout.current = setTimeout(() => setIdle(true), timeoutMs);
    };

    schedule();

    const handleActivity = () => {
      setIdle(false);
      schedule();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
    };
  }, [enabled, timeoutMs]);

  return {
    isIdle: enabled && idle,
    resetIdle,
    hideControls,
  };
};
