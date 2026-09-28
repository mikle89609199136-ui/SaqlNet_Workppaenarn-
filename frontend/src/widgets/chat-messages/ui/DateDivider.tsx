import { cn } from '@/shared/lib';
import { memo } from 'react';

interface Props {
  label: string;
  variant?: 'inline' | 'sticky';
  visible?: boolean;
  pushOffset?: number;
  paddingRight?: number;
}

/* Дата — таблетка по центру, как в макете (#820): приподнятая
   поверхность, 12px. Липкая копия сверху — та же таблетка. */
const pill = 'rounded-pill bg-sheet-2 px-3 py-1 text-meta font-medium text-ink-2';

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
          <span className={pill}>{label}</span>
        </div>
      );
    }

    return (
      <div className="flex justify-center py-2 select-none pointer-events-none">
        <span className={pill}>{label}</span>
      </div>
    );
  }
);

DateDivider.displayName = 'DateDivider';
