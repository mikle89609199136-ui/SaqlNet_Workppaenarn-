import { useEffect, useState } from 'react';

export function useCountdown(initialSeconds) {
  const safeInitialSeconds = Number.isFinite(initialSeconds) && initialSeconds > 0 ? initialSeconds : 60;
  const [remaining, setRemaining] = useState(safeInitialSeconds);

  useEffect(() => {
    if (remaining <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setRemaining((value) => Math.max(value - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [remaining]);

  return {
    initialSeconds: safeInitialSeconds,
    isComplete: remaining <= 0,
    remaining,
  };
}
