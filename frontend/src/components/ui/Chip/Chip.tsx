import { Icon } from '@/components/ui/Icon/Icon';
import { cn } from '@/utils';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onRemove?: () => void;
  /* Имя кнопки-крестика: «Убрать Бориса». Без него диктор объявит просто
     «кнопка», и что она убирает — непонятно. */
  removeLabel?: string;
  className?: string;
}

export const Chip = ({ children, onRemove, removeLabel, className }: Props) => {
  return (
    <span
      className={cn(
        'inline-flex max-w-48 items-center gap-1.5 rounded-pill border border-line bg-sheet-2 py-1 pl-3 text-ink',
        'text-caption font-medium transition-colors duration-fast hover:border-ink-3',
        onRemove ? 'pr-1' : 'pr-3',
        className
      )}
    >
      {/* Длинное имя обрезается многоточием: чип не должен растягивать
          строку и переносить соседей. */}
      <span className="truncate">{children}</span>

      {onRemove && (
        <button
          aria-label={removeLabel}
          className={cn(
            /* 24 на 24 — наименьшая мишень по 2.5.8. При меньшем крестик
               попадает мимо пальца. */
            'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-pill',
            'text-ink-3 transition-colors duration-fast hover:bg-sheet hover:text-ink',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1'
          )}
          onClick={onRemove}
          type="button"
        >
          <Icon name="cross" size="sm" />
        </button>
      )}
    </span>
  );
};
