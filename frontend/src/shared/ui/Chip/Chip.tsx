import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /* Слева, до подписи: аватарка выбранного человека. */
  leading?: ReactNode;
  onRemove?: () => void;
  /* Имя кнопки-крестика: «Убрать Бориса». Без него диктор объявит просто
     «кнопка», и что она убирает — непонятно. */
  removeLabel?: string;
  className?: string;
}

/* Выбранное — участник новой группы, получатель пересылки. По макету
   (#817): таблетка 30px на подложке акцента, текст цветом акцента,
   аватарка 24 слева, крестик 12 справа. */
export const Chip = ({ children, leading, onRemove, removeLabel, className }: Props) => {
  return (
    <span
      className={cn(
        'inline-flex h-7.5 max-w-48 items-center gap-1.5 rounded-pill bg-brand-soft text-brand',
        'text-caption font-medium',
        leading ? 'pl-0.75' : 'pl-3',
        onRemove ? 'pr-0.5' : 'pr-3',
        className
      )}
    >
      {leading && <span className="flex shrink-0">{leading}</span>}

      {/* Длинное имя обрезается многоточием: чип не должен растягивать
          строку и переносить соседей. */}
      <span className="truncate">{children}</span>

      {onRemove && (
        <button
          aria-label={removeLabel}
          className={cn(
            /* Крестик 12, мишень 24 на 24 — наименьшая по 2.5.8: при
               меньшей палец попадает мимо. */
            'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-pill',
            'text-brand transition-colors duration-fast hover:layer-hover active:layer-press',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1'
          )}
          onClick={onRemove}
          type="button"
        >
          <Icon className="size-3 stroke-[2.6px]" name="cross" />
        </button>
      )}
    </span>
  );
};
