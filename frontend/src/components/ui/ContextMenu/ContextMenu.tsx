import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
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
  className?: string;
}

export const ContextMenuItem = forwardRef<HTMLButtonElement, ContextMenuItemProps>(
  function ContextMenuItem(
    { icon, variant = 'default', disabled, className, children, onClick, ...props },
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

    return () => cancelAnimationFrame(timer);
  }, [open]);

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
        if (anchorRef?.current) {
          anchorRef.current.focus();
        }
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
        'fixed z-50 p-1.5 min-w-[216px] outline-none',
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

  const handleContextMenu = useCallback((e: ReactMouseEvent | MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ open: true, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  };
}
