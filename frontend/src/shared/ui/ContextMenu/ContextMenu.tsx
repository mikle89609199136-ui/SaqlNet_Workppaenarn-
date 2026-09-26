import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/lib';
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/* --- Разделитель --- */
export interface ContextMenuSeparatorProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const ContextMenuSeparator = ({ className, ...props }: ContextMenuSeparatorProps) => {
  return (
    <div role="separator" className={cn('h-px bg-divider my-1.5 mx-1', className)} {...props} />
  );
};

/* --- Пункт меню --- */
export interface ContextMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  /** Сочетание клавиш — подсказкой справа, как в меню настольных программ. */
  shortcut?: string;
  className?: string;
}

export const ContextMenuItem = forwardRef<HTMLButtonElement, ContextMenuItemProps>(
  function ContextMenuItem(
    { icon, variant = 'default', shortcut, disabled, className, children, onClick, ...props },
    ref
  ) {
    return (
      <Button
        ref={ref}
        role="menuitem"
        type="button"
        variant={variant === 'danger' ? 'danger' : 'ghost'}
        size="sm"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={shortcut}
        onClick={onClick}
        className={cn(
          'w-full justify-start font-normal text-sm border-0 rounded-control gap-2.5 px-2.5 py-2 text-left',
          variant === 'default' && 'text-ink hover:text-ink hover:bg-sheet-2',
          variant === 'danger' && 'text-danger hover:bg-sheet-2 border-transparent',
          className
        )}
        {...props}
      >
        {icon && (
          <span className="size-4 shrink-0 flex items-center justify-center [&>svg]:size-4">
            {icon}
          </span>
        )}
        <span className="flex-1 truncate text-left">{children}</span>
        {shortcut && (
          <span className="ml-4 shrink-0 text-micro text-ink-3 tabular-nums">{shortcut}</span>
        )}
      </Button>
    );
  }
);

/* --- Контекстное меню --- */
interface Props {
  open: boolean;
  onClose: () => void;
  x?: number;
  y?: number;
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * Куда вернуть фокус при закрытии. Для меню, открытого по координатам:
   * правый клик и долгое нажатие фокус никуда не переводят, поэтому
   * запоминать активный элемент бесполезно — там `body`.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

const ContextMenuRoot = ({
  open,
  onClose,
  x,
  y,
  anchorRef,
  returnFocusRef,
  className,
  id: customId,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  children,
}: PropsWithChildren<Props>) => {
  const generatedId = useId();
  const id = customId ?? generatedId;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: y ?? 0,
    left: x ?? 0,
  });

  const updatePosition = useCallback(() => {
    if (!open || !menuRef.current) return;
    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let posX = x ?? 0;
    let posY = y ?? 0;

    if (anchorRef?.current) {
      const anchorRect = anchorRef.current.getBoundingClientRect();
      posX = anchorRect.left;
      posY = anchorRect.bottom + 4;

      /* Не помещается снизу — раскрывается вверх. Прежде меню в такой
         ситуации просто прижималось к нижнему краю и накрывало собой
         кнопку, которой его открыли. */
      const fitsBelow = posY + menuRect.height <= viewportHeight - 8;
      const fitsAbove = anchorRect.top - menuRect.height - 4 >= 8;
      if (!fitsBelow && fitsAbove) {
        posY = anchorRect.top - menuRect.height - 4;
      }
    }

    if (posX + menuRect.width > viewportWidth - 8) {
      posX = Math.max(8, viewportWidth - menuRect.width - 8);
    }
    if (posY + menuRect.height > viewportHeight - 8) {
      posY = Math.max(8, viewportHeight - menuRect.height - 8);
    }

    setPosition({
      top: Math.max(8, posY),
      left: Math.max(8, posX),
    });
  }, [open, x, y, anchorRef]);

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    }

    function handleScroll(e: Event) {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      onClose();
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, onClose, anchorRef, updatePosition]);

  /* Куда вернуть фокус, когда меню закроется. Раньше он возвращался
     только при `anchorRef`, а контекстное меню открывают по координатам —
     и после Escape фокус оставался на body: человек, идущий по списку с
     клавиатуры, терял место и начинал обход заново. */
  useEffect(() => {
    if (!open) return;

    const timer = requestAnimationFrame(() => {
      if (!menuRef.current) return;
      const items = menuRef.current.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not([disabled])'
      );
      if (items.length > 0) {
        items[0].focus();
      } else {
        menuRef.current.focus();
      }
    });

    return () => {
      cancelAnimationFrame(timer);

      /* Возвращается только фокус, ушедший внутрь меню. Если за это время
         его забрал кто-то другой — например, открылось окно поверх, —
         отбирать обратно нельзя. */
      const insideMenu = menuRef.current?.contains(document.activeElement);
      if (insideMenu || document.activeElement === document.body) {
        (anchorRef?.current ?? returnFocusRef?.current)?.focus?.();
      }
    };
  }, [open, anchorRef, returnFocusRef]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!menuRef.current) return;

    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
    );
    const activeIndex = items.findIndex((item) => item === document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
        items[nextIndex]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
        items[prevIndex]?.focus();
        break;
      }
      case 'Home': {
        e.preventDefault();
        items[0]?.focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      }
      case 'Escape': {
        e.preventDefault();
        onClose();
        break;
      }
      case 'Tab': {
        onClose();
        break;
      }
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      onKeyDown={handleKeyDown}
      className={cn(
        /* Высота ограничена: пятнадцать пунктов иначе уходят за нижний
           край, потому что позиция зажимается, а содержимое — нет. */
        'fixed z-50 p-1.5 min-w-[216px] max-h-[min(60vh,420px)] overflow-y-auto outline-none',
        'styled-scrollbar',
        'bg-sheet border border-line rounded-field shadow-[var(--elev-3)]',
        'flex flex-col gap-0.5',
        className
      )}
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {children}
    </div>,
    document.body
  );
};

export const ContextMenu = Object.assign(ContextMenuRoot, {
  ContextMenuItem,
  ContextMenuSeparator,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
});

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number } | null>(
    null
  );

  /* Элемент, на котором вызвали меню: ему возвращается фокус при
     закрытии. Активный элемент для этого не годится — ни правый клик, ни
     долгое нажатие фокус не переводят. */
  const openerRef = useRef<HTMLElement | null>(null);

  const handleContextMenu = useCallback((e: ReactMouseEvent | MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = (e as ReactMouseEvent).currentTarget ?? e.target;
    if (target instanceof HTMLElement) openerRef.current = target;

    setContextMenu({ open: true, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    handleContextMenu,
    closeContextMenu,
    openerRef,
  };
}
