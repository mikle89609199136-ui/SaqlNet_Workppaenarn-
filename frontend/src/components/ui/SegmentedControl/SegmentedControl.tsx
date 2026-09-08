import { cn } from '@/utils';
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
        className={cn('inline-flex bg-sheet-2 rounded-field p-1 gap-1', className)}
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
                'text-caption font-medium bg-transparent text-ink-2 px-3.5 py-1.5 rounded-control cursor-pointer transition-all duration-fast',
                'disabled:opacity-42 disabled:cursor-not-allowed',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
                'data-[state=active]:bg-sheet data-[state=active]:text-ink data-[state=active]:shadow-[var(--elev-1)] data-[state=active]:font-semibold'
              )}
            >
              <span
                className="inline-flex flex-col items-center justify-center after:content-[attr(data-text)] after:font-semibold after:h-0 after:invisible after:overflow-hidden after:pointer-events-none after:select-none"
                data-text={opt.label}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
);
