import { cn } from '@/utils';
import { useId, type ReactNode, type ReactElement, cloneElement, isValidElement } from 'react';

/* Подсказка описывает соседа, поэтому ей нужен элемент, которому можно
   проставить aria-describedby — то есть принимающий атрибуты. */
interface Describable {
  'aria-describedby'?: string;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Describable>;
  className?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, className, position = 'top' }: TooltipProps) {
  const id = useId();

  const trigger = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': id })
    : children;

  return (
    <div className="group relative inline-flex">
      {trigger}
      <div
        id={id}
        role="tooltip"
        className={cn(
          'absolute z-50 pointer-events-none px-3 py-1.5 bg-ink text-ground text-caption rounded-control whitespace-nowrap',
          'opacity-0 invisible scale-95 transition-all duration-fast',
          'group-hover:opacity-100 group-hover:visible group-hover:scale-100',
          'group-focus-within:opacity-100 group-focus-within:visible group-focus-within:scale-100',
          position === 'top' && 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
          position === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-1.5',
          position === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-1.5',
          position === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-1.5',
          className
        )}
      >
        {content}
      </div>
    </div>
  );
}
