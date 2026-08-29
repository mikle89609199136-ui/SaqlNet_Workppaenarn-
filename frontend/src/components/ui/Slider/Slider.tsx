import { cn } from '@/utils';
import { forwardRef, type InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: number;
  min?: number;
  max?: number;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { value, min = 0, max = 100, className, ...rest },
  ref
) {
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) || 0;

  return (
    <div className={cn('relative flex items-center h-4', className)}>
      <input
        ref={ref}
        type="range"
        value={value}
        min={min}
        max={max}
        className={cn(
          'peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
          '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4'
        )}
        {...rest}
      />

      <div className="relative w-full h-1 bg-sheet-2 rounded-pill pointer-events-none">
        <div
          className="absolute left-0 top-0 h-full bg-brand-fill rounded-pill"
          style={{ width: `calc((100% - 16px) * ${percentage / 100} + 8px)` }}
        />
        {/*
          Кастомный бегунок. 
          Чтобы он не разъезжался с невидимым нативным бегунком на краях (нативный не уходит за края),
          смещаем его с учётом его собственной ширины (16px).
        */}
        <div
          className={cn(
            'absolute top-1/2 w-4 h-4 rounded-pill bg-brand-fill -translate-y-1/2 shadow-[var(--elev-1)]',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2'
          )}
          style={{ left: `calc((100% - 16px) * ${percentage / 100})` }}
        />
      </div>
    </div>
  );
});
