import { Icon } from '@/shared/ui/Icon';
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
import { useTranslation } from 'react-i18next';

/* Пункты, по которым ходят стрелками. Отмечаемый пункт — тоже пункт:
   у него своя роль, menuitemcheckbox, и без неё в селекторе он выпадал
   бы из обхода. */
const ITEM_SELECTOR =
  'button[role="menuitem"]:not([disabled]), button[role="menuitemcheckbox"]:not([disabled])';

/* --- Разделитель --- */
export interface ContextMenuSeparatorProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const ContextMenuSeparator = ({ className, ...props }: ContextMenuSeparatorProps) => {
  return (
    <div role="separator" className={cn('mx-1.5 my-1 h-px bg-divider', className)} {...props} />
  );
};

/* --- Пункт меню --- */
export interface ContextMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  /** Опасное действие ставят последним, после разделителя, и подтверждают. */
  variant?: 'default' | 'danger';
  /** Сочетание клавиш — подсказкой справа, как в меню настольных программ. */
  shortcut?: string;
  /**
   * Пункт-отметка: включённое форматирование, выбранный звук. Задан —
   * пункт получает роль menuitemcheckbox и подложку акцента, когда включён.
   */
  checked?: boolean;
  /** Пункт открывает подменю: стрелка справа. */
  submenu?: boolean;
  className?: string;
}

/* Пункт меню по дизайн-системе (#817): 38px, иконка 18px слева, клавиша
   справа. Наведение и нажатие — слоем поверх фона, а не его заменой:
   иначе отмеченный пункт при наведении терял бы подложку и казался
   выключенным. Недоступный остаётся на месте, приглушённый: человек
   видит, что действие есть. */
export const ContextMenuItem = forwardRef<HTMLButtonElement, ContextMenuItemProps>(
  function ContextMenuItem(
    {
      icon,
      variant = 'default',
      shortcut,
      checked,
      submenu = false,
      disabled,
      className,
      children,
      onClick,
      ...props
    },
    ref
  ) {
    const checkable = checked !== undefined;

    return (
      <button
        ref={ref}
        role={checkable ? 'menuitemcheckbox' : 'menuitem'}
        type="button"
        disabled={disabled}
        aria-checked={checkable ? checked : undefined}
        aria-disabled={disabled || undefined}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-keyshortcuts={shortcut}
        onClick={onClick}
        className={cn(
          'flex min-h-9.5 w-full shrink-0 cursor-pointer items-center gap-3 rounded-field px-2.5 py-2 text-left text-ui',
          'transition-colors duration-fast',
          'enabled:hover:layer-hover enabled:active:layer-press',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
          'disabled:cursor-default disabled:opacity-40',
          variant === 'danger' ? 'text-danger' : 'text-ink',
          checked && 'bg-brand-soft text-brand',
          className
        )}
        {...props}
      >
        {icon && (
          <span className="flex size-4.5 shrink-0 items-center justify-center [&>svg]:size-4.5">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {shortcut && (
          <span className="ml-3 shrink-0 text-meta text-ink-3 tabular-nums">{shortcut}</span>
        )}
        {submenu && (
          <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-3" name="chevronRight" />
        )}
      </button>
    );
  }
);

/* --- Возврат из подменю --- */
/* Подменю заменяет содержимое меню, а не раскрывается сбоку: на телефоне
   второй колонке негде встать. Путь назад — первой строкой. */
export const ContextMenuBack = forwardRef<
  HTMLButtonElement,
  Omit<ContextMenuItemProps, 'icon' | 'children' | 'checked' | 'submenu'>
>(function ContextMenuBack(props, ref) {
  const { t } = useTranslation();

  return (
    <ContextMenuItem
      ref={ref}
      icon={<Icon aria-hidden="true" className="rotate-180" name="chevronRight" />}
      {...props}
    >
      {t('back', 'Назад')}
    </ContextMenuItem>
  );
});

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
      const items = menuRef.current.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR);
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

    const items = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR));
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
        'fixed z-50 p-1.5 min-w-63 max-h-[min(60vh,420px)] overflow-y-auto outline-none',
        'styled-scrollbar',
        'bg-menu border border-divider rounded-bubble shadow-[var(--shadow-menu)]',
        'flex flex-col gap-px',
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
  Back: ContextMenuBack,
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
