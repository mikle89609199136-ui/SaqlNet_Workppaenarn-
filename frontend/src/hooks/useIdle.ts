import { useCallback, useEffect, useRef, useState } from 'react';

interface UseIdleOptions {
  enabled?: boolean;
  timeoutMs?: number;
}

export const useIdle = ({ enabled = true, timeoutMs = 2000 }: UseIdleOptions = {}) => {
  const [isIdle, setIsIdle] = useState(false);
  const idleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const resetIdle = useCallback(() => {
    setIsIdle(false);
    if (idleTimeout.current) clearTimeout(idleTimeout.current);
    if (enabledRef.current) {
      idleTimeout.current = setTimeout(() => setIsIdle(true), timeoutMs);
    }
  }, [timeoutMs]);

  const hideControls = useCallback(() => {
    if (idleTimeout.current) clearTimeout(idleTimeout.current);
    setIsIdle(true);
  }, []);

  useEffect(() => {
    if (enabled) {
      resetIdle();
      const handleActivity = () => resetIdle();
      window.addEventListener('mousemove', handleActivity);
      window.addEventListener('keydown', handleActivity);
      return () => {
        window.removeEventListener('mousemove', handleActivity);
        window.removeEventListener('keydown', handleActivity);
        if (idleTimeout.current) clearTimeout(idleTimeout.current);
      };
    } else {
      setIsIdle(false);
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
    }
  }, [enabled, resetIdle]);

  return {
    isIdle,
    resetIdle,
    hideControls,
  };
};
