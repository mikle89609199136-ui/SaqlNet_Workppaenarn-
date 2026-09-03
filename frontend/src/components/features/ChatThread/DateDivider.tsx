import { cn } from '@/utils';
import { memo } from 'react';

interface Props {
  label: string;
  variant?: 'inline' | 'sticky';
  visible?: boolean;
  pushOffset?: number;
  paddingRight?: number;
}

export const DateDivider = memo(
  ({ label, variant = 'inline', visible = true, pushOffset = 0, paddingRight = 0 }: Props) => {
    if (!label) return null;

    if (variant === 'sticky') {
      return (
        <div
          className={cn(
            'absolute top-2 inset-x-0 flex justify-center pointer-events-none select-none z-10 transition-opacity duration-300',
            visible ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            transform: pushOffset ? `translateY(${pushOffset}px)` : undefined,
            paddingRight: paddingRight ? `${paddingRight}px` : undefined,
          }}
        >
          <span className="px-3.5 py-1 rounded-pill bg-sheet-2/90 backdrop-blur-md border border-line-soft text-caption font-medium text-ink-3 shadow-xs">
            {label}
          </span>
        </div>
      );
    }

    return (
      <div className="flex justify-center my-2 select-none pointer-events-none">
        <span className="px-3.5 py-1 rounded-pill bg-sheet-2/90 backdrop-blur-md border border-line-soft text-caption font-medium text-ink-3 shadow-xs">
          {label}
        </span>
      </div>
    );
  }
);

DateDivider.displayName = 'DateDivider';
