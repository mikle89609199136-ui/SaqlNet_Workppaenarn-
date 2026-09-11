import { cn } from '@/shared/lib';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: number;
  min?: number;
  max?: number;
  /**
   * Что диктор скажет вместо числа. У проигрывателя значение — секунды, и
   * читать «семьдесят два» бессмысленно: человеку нужно «одна минута
   * двенадцать секунд». Без этого ползунок времени бесполезен на слух.
   */
  valueText?: string;
  /* Подпись справа от дорожки: в ките это «01:12 / 03:08». */
  caption?: ReactNode;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { value, min = 0, max = 100, valueText, caption, className, ...rest },
  ref
) {
  const span = max - min;
  const percentage = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative flex h-4 flex-1 items-center">
        <input
          aria-valuetext={valueText}
          className={cn(
            'peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0',
            '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none',
            '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none',
            'disabled:cursor-not-allowed'
          )}
          max={max}
          min={min}
          ref={ref}
          type="range"
          value={value}
          {...rest}
        />

        {/* Дорожка та же, что у полосы загрузки: мягкий разделитель, а не
            приподнятая поверхность — на светлой теме та почти сливается
            с фоном. */}
        <div className="pointer-events-none relative h-1.5 w-full rounded-pill bg-line-soft peer-disabled:opacity-42">
          <div
            className="absolute top-0 left-0 h-full rounded-pill bg-brand-fill"
            style={{ width: `calc((100% - 16px) * ${percentage / 100} + 8px)` }}
          />
          {/*
            Кастомный бегунок.
            Чтобы он не разъезжался с невидимым нативным бегунком на краях (нативный не уходит за края),
            смещаем его с учётом его собственной ширины (16px).
          */}
          <div
            className={cn(
              'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-pill bg-brand-fill shadow-[var(--elev-1)]',
              'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2'
            )}
            style={{ left: `calc((100% - 16px) * ${percentage / 100})` }}
          />
        </div>
      </div>

      {caption && <span className="text-caption shrink-0 tabular-nums text-ink-3">{caption}</span>}
    </div>
  );
});
