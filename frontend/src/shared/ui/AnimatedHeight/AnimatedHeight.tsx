import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** С запасом к duration-panel: страховка, если transitionend не придёт. */
const SETTLE_MS = 400;
import { cn } from '@/shared/lib';

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * Блок, который меняет высоту плавно, а не скачком.
 *
 * Высоту `auto` CSS анимировать не умеет, поэтому содержимое измеряется, и
 * высота ставится числом — её уже можно вести переходом. `overflow` режется
 * только на время перехода: постоянно обрезанный блок срезал бы кольца
 * фокуса и тени у полей внутри.
 *
 * Нулевая высота — это «ещё не измерено» (или тестовое окружение без
 * раскладки), и тогда блок остаётся в `auto`.
 */
export function AnimatedHeight({ children, className }: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? inner.offsetHeight;
      if (!next || next === heightRef.current) return;

      // Первое измерение — без перехода: блок только появился.
      if (heightRef.current !== null) setAnimating(true);
      heightRef.current = next;
      setHeight(next);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // Без перехода (prefers-reduced-motion, та же высота) transitionend не
  // приходит, и без страховки блок остался бы обрезанным.
  useEffect(() => {
    if (!animating) return undefined;
    const timer = setTimeout(() => setAnimating(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [animating, height]);

  return (
    <div
      className={cn(
        'transition-[height] duration-panel ease-out motion-reduce:transition-none',
        animating && 'overflow-hidden',
        className
      )}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setAnimating(false);
      }}
      style={height === null ? undefined : { height }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
