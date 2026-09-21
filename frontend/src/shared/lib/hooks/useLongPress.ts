import { useCallback, useEffect, useRef } from 'react';

/** Сколько держать, чтобы это считалось долгим нажатием. */
const HOLD_MS = 450;

/** Насколько палец может сместиться: дальше это уже прокрутка, а не нажатие. */
const SLOP_PX = 10;

/**
 * Долгое нажатие — то же, что правый клик, только пальцем.
 *
 * Отдельно от `useMessageLongPress`: тот знает про выделение сообщений и
 * их меню, здесь же нужен голый жест.
 *
 * Смещение отменяет жест: без этого меню открывалось бы при каждой
 * попытке прокрутить список пальцем, начатой с задержкой.
 */
export function useLongPress(onTrigger: (x: number, y: number) => void) {
  const callbackRef = useRef(onTrigger);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    callbackRef.current = onTrigger;
  }, [onTrigger]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (event: React.PointerEvent) => {
      // Мышь сюда не попадает: у неё для этого есть правая кнопка.
      if (event.pointerType === 'mouse') return;

      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        const start = startRef.current;
        if (start) callbackRef.current(start.x, start.y);
        cancel();
      }, HOLD_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) return;

      const moved =
        Math.abs(event.clientX - start.x) > SLOP_PX || Math.abs(event.clientY - start.y) > SLOP_PX;

      if (moved) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
