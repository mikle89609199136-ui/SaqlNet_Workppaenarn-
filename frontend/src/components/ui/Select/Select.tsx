import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/utils';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';
import { SelectMenu } from './SelectMenu';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export const Select =({
  options,
  value,
  onChange,
  placeholder = 'Выбрать',
  label,
  hint,
  error,
  size = 'md',
  disabled,
  required,
  className,
}: Props) => {
  const ownId = useId();
  const listboxId = `${ownId}-listbox`;
  const captionId = `${ownId}-caption`;
  const caption = error ?? hint;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openMenu = useCallback(() => {
    if (disabled) return;
    let targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
    if (options[targetIndex]?.disabled) {
      const firstEnabled = options.findIndex(o => !o.disabled);
      if (firstEnabled >= 0) targetIndex = firstEnabled;
    }
    setActiveIndex(targetIndex);
    setOpen(true);
  }, [disabled, selectedIndex, options]);

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, closeMenu]);

  // Effect without deps runs on every render, ensuring scroll happens once menuRef is available
  useEffect(() => {
    if (!open) return;
    const menuNode = menuRef.current;
    if (!menuNode) return;
    const el = menuNode.children[activeIndex] as HTMLElement | undefined;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });

  const moveActive = useCallback(
    (nextIndex: number) => {
      const step = nextIndex > activeIndex ? 1 : -1;
      let index = Math.max(0, Math.min(nextIndex, options.length - 1));
      while (index >= 0 && index < options.length) {
        if (!options[index]?.disabled) {
          setActiveIndex(index);
          return;
        }
        index += step;
      }
    },
    [activeIndex, options]
  );

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      closeMenu();
      triggerRef.current?.focus();
    },
    [options, onChange, closeMenu]
  );

  function handleTriggerClick() {
    if (open) closeMenu();
    else openMenu();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) return openMenu();
        moveActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      case 'Enter': {
        event.preventDefault();
        if (open) commit(activeIndex);
        else openMenu();
        return;
      }
      case 'Escape': {
        if (!open) return;
        event.preventDefault();
        closeMenu();
        return;
      }
      case 'Home': {
        if (!open) return;
        event.preventDefault();
        moveActive(0);
        return;
      }
      case 'End': {
        if (!open) return;
        event.preventDefault();
        moveActive(options.length - 1);
        return;
      }
      case 'Tab': {
        if (open) closeMenu();
        return;
      }
      default:
        return;
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-caption font-medium text-ink-2">
          {label}
          {required && (
            <span aria-hidden="true" className="text-danger">
              {' *'}
            </span>
          )}
        </label>
      )}

      <Button
        ref={triggerRef}
        id={ownId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        aria-describedby={caption ? captionId : undefined}
        aria-invalid={error ? true : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        variant="secondary"
        size={size}
        className={cn(
          'w-full justify-between text-left font-normal group hover:bg-brand-fill-hover hover:border-brand-fill-hover',
          open && 'border-brand ring-3 ring-brand-soft',
          error && !open && 'border-danger'
        )}
      >
        <span
          className={cn(
            'flex-1 truncate transition-colors duration-fast group-hover:text-ink',
            !selected && 'text-ink-3'
          )}
        >
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          aria-hidden="true"
          name="chevronDown"
          size="sm"
          className={cn(
            'shrink-0 text-ink-3 transition-all duration-fast group-hover:text-ink',
            open && 'rotate-180'
          )}
        />
      </Button>

      {open && (
        <SelectMenu menuRef={menuRef} anchorRef={triggerRef} onClose={closeMenu}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;

            return (
              <li
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onClick={() => commit(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-body',
                  'transition-colors duration-fast',
                  option.disabled && 'cursor-not-allowed text-ink-3',
                  !option.disabled && 'hover:bg-sheet-2',
                  !option.disabled && isActive && 'bg-sheet-2',
                  isSelected && 'font-semibold'
                )}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && (
                  <Icon
                    aria-hidden="true"
                    name="check"
                    size="sm"
                    className="ml-auto shrink-0 text-brand"
                  />
                )}
              </li>
            );
          })}
        </SelectMenu>
      )}

      {caption && (
        <p
          className={cn('text-caption', error ? 'text-danger' : 'text-ink-3')}
          id={captionId}
          role={error ? 'alert' : undefined}
        >
          {caption}
        </p>
      )}
    </div>
  );
}