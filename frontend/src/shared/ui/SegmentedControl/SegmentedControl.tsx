import { cn } from '@/shared/lib';
import { forwardRef, type HTMLAttributes } from 'react';

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string; disabled?: boolean }[];
}

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl({ value, onChange, options, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        /* Сегменты равной ширины (дизайн-система, #817): переключатель из
           двух-трёх вариантов читается как одно целое, а не как ряд кнопок
           по длине подписи. */
        className={cn(
          'inline-grid grid-flow-col auto-cols-fr gap-1 rounded-button bg-sheet-2 p-1',
          className
        )}
        role="group"
        {...rest}
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              data-state={isActive ? 'active' : 'inactive'}
              aria-pressed={isActive}
              onClick={() => onChange(opt.value)}
              className={cn(
                'h-9.5 px-3.5 rounded-field text-ui font-semibold bg-transparent text-ink-2 cursor-pointer transition-all duration-fast',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
                'data-[state=active]:bg-sheet data-[state=active]:text-ink data-[state=active]:shadow-[var(--shadow-tab)]'
              )}
            >
              {/* Вес у всех сегментов один, выбранный отличается фоном и
                  цветом: жирный текст шире, и полоса дёргалась бы при
                  каждом переключении. */}
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }
);
