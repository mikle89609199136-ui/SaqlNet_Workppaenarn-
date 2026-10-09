import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '@/shared/lib';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Палец отпущен или шаг с клавиатуры сделан — момент записать в историю. */
  onCommit?: () => void;
}

const KEY_STEPS: Record<string, (value: number, min: number, max: number) => number> = {
  ArrowUp: (value) => value + 1,
  ArrowRight: (value) => value + 1,
  ArrowDown: (value) => value - 1,
  ArrowLeft: (value) => value - 1,
  PageUp: (value) => value + 10,
  PageDown: (value) => value - 10,
  Home: (_value, min) => min,
  End: (_value, _min, max) => max,
};

/**
 * Размер кисти или текста — клином у края фото, как в Telegram и Instagram:
 * вверх толще, вниз тоньше. Полке не нужна ещё одна строка, а размер виден
 * сразу на снимке.
 *
 * Свой элемент, а не повёрнутый `<input type="range">`: вертикальный
 * ползунок через writing-mode Safari понимает только с 17.4.
 */
export function EditorSizeSlider({ label, value, min, max, onChange, onCommit }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const share = (value - min) / (max - min);

  const valueAt = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return value;
    const part = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    return Math.round(min + part * (max - min));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    setIsDragging(true);
    onChange(valueAt(event.clientY));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging) onChange(valueAt(event.clientY));
  };

  const handlePointerEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    onCommit?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(clamp(step(value, min, max), min, max));
    onCommit?.();
  };

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className="group absolute left-2 top-1/2 z-20 h-[min(46%,260px)] w-10 -translate-y-1/2 cursor-pointer touch-none outline-none md:left-4"
      data-state={isDragging ? 'active' : 'idle'}
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      ref={trackRef}
      role="slider"
      tabIndex={0}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-5 -translate-x-1/2 bg-white/35 shadow-[var(--elev-1)] [clip-path:polygon(0_0,100%_0,56%_100%,44%_100%)]" />
      <span
        className="pointer-events-none absolute left-1/2 size-6 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-[var(--elev-2)] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-brand group-focus-visible:outline-offset-2"
        style={{ bottom: `${share * 100}%` }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-full ml-1 min-w-9 translate-y-1/2 rounded-pill bg-scrim px-2 py-0.5 text-center text-caption font-semibold text-on-scrim tabular-nums opacity-0 transition-opacity duration-fast group-focus-visible:opacity-100 group-data-[state=active]:opacity-100"
        style={{ bottom: `${share * 100}%` }}
      >
        {value}
      </span>
    </div>
  );
}
