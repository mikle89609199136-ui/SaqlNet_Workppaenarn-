import { STORAGE_KEYS } from '@/shared/config';
import { useCallback, useRef, useState } from 'react';

type TPane = 'sidebar' | 'profile';

interface Limits {
  min: number;
  max: number;
  fallback: number;
}

function readStored(): Partial<Record<TPane, number>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PANE_WIDTHS);
    return raw ? (JSON.parse(raw) as Partial<Record<TPane, number>>) : {};
  } catch {
    /* Хранилище может быть недоступно — приватное окно, запрет на сайт,
       испорченный JSON. Ширина по умолчанию хуже подобранной, но лучше
       белого экрана. */
    return {};
  }
}

/**
 * Ширина колонки, пережившая перезагрузку.
 *
 * Значение читается один раз при первом рендере и записывается по концу
 * перетаскивания, а не на каждое движение: за одно перетаскивание иначе
 * выходит несколько сотен обращений к хранилищу.
 *
 * Прочитанное зажимается в допустимые границы: там может лежать что
 * угодно — от значения прошлой версии до правки руками.
 *
 * Рядом с состоянием живёт ссылка на то же число. Она нужна для шага
 * стрелкой: при удержании клавиши события идут чаще, чем React успевает
 * перерисовать, и обработчик, читающий ширину из замыкания, вычислял бы
 * каждый раз одно и то же — колонка сдвигалась бы на один шаг вместо
 * плавного роста.
 */
export function usePaneWidth(pane: TPane, { min, max, fallback }: Limits) {
  const clamp = useCallback((value: number) => Math.min(Math.max(value, min), max), [min, max]);

  const [width, setWidthState] = useState(() => {
    const stored = readStored()[pane];
    if (typeof stored !== 'number' || Number.isNaN(stored)) return fallback;
    return clamp(stored);
  });

  const widthRef = useRef(width);

  const remember = useCallback(
    (value: number) => {
      try {
        const stored = readStored();
        localStorage.setItem(
          STORAGE_KEYS.PANE_WIDTHS,
          JSON.stringify({ ...stored, [pane]: value })
        );
      } catch {
        // Не сохранилось — ширина просто не переживёт перезагрузку.
      }
    },
    [pane]
  );

  const setWidth = useCallback((value: number) => {
    widthRef.current = value;
    setWidthState(value);
  }, []);

  /** Шаг клавишей: считается от последнего значения, а не от отрисованного. */
  const nudge = useCallback(
    (delta: number) => {
      const next = clamp(widthRef.current + delta);
      setWidth(next);
      remember(next);
    },
    [clamp, remember, setWidth]
  );

  const jump = useCallback(
    (edge: 'min' | 'max') => {
      const next = edge === 'min' ? min : max;
      setWidth(next);
      remember(next);
    },
    [min, max, remember, setWidth]
  );

  return { width, setWidth, remember, nudge, jump };
}
