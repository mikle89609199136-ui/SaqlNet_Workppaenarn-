import { useEffect, useState } from 'react';

export function formatCallDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(elapsedSec / 3600);
  const minutes = Math.floor((elapsedSec % 3600) / 60);
  const seconds = elapsedSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function useCallDuration(startedAt: number | null): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!startedAt) return;

    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [startedAt]);

  return startedAt ? formatCallDuration(startedAt) : '00:00';
}
