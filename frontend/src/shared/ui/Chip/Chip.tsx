import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';
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
        /* Как вторичная кнопка дизайн-системы: узнаётся по заливке, без
           рамки. */
        'inline-flex h-8 max-w-48 items-center gap-1.5 rounded-pill bg-sheet-2 pl-3 text-ink',
        'text-caption font-medium',
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
            'text-ink-2 transition-colors duration-fast hover:layer-hover hover:text-ink active:layer-press',
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
