import { Button } from '@/shared/ui/Button';
import { FieldCaption, FieldLabel, useField } from '@/shared/ui/Field';
import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { SelectMenu } from './SelectMenu';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  /**
   * Идентификатор кнопки, открывающей список. Нужен, когда подпись стоит
   * вне компонента и связывается с ним через `htmlFor` — например в ряду
   * настройки, где подпись слева, а список справа.
   */
  id?: string;
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

/**
 * Список выбора.
 *
 * `ref` указывает на кнопку, открывающую список, а не на обёртку: снаружи
 * его просят ради фокуса — увести человека к полю с ошибкой или открыть
 * выбор с клавиатуры. Обёртка для этого не годится, она не фокусируется.
 */
export const Select = forwardRef<HTMLButtonElement, Props>(function Select(
  {
    id,
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
  },
  ref
) {
  const {
    fieldId: ownId,
    captionId,
    caption,
    isError,
    controlProps,
  } = useField({ id, hint, error });
  const listboxId = `${ownId}-listbox`;
  const labelId = `${ownId}-label`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  // Внутренний ref нужен самому компоненту — вернуть фокус на кнопку после
  // выбора и закрытия. Внешний получает тот же элемент.
  useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement, []);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openMenu = useCallback(() => {
    if (disabled) return;
    let targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
    if (options[targetIndex]?.disabled) {
      const firstEnabled = options.findIndex((o) => !o.disabled);
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

  /* Направление поиска задаётся явно, а не выводится из того, куда
     двинулись. Раньше оно вычислялось сравнением с текущим пунктом, и
     Home с End срывались, когда крайний пункт отключён: поиск уходил за
     край списка вместо того, чтобы шагнуть внутрь. */
  const moveActive = useCallback(
    (from: number, step: 1 | -1) => {
      let index = Math.max(0, Math.min(from, options.length - 1));

      while (index >= 0 && index < options.length) {
        if (!options[index]?.disabled) {
          setActiveIndex(index);
          return;
        }

        index += step;
      }
    },
    [options]
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
        const down = event.key === 'ArrowDown';
        moveActive(activeIndex + (down ? 1 : -1), down ? 1 : -1);
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
        moveActive(0, 1);
        return;
      }
      case 'End': {
        if (!open) return;
        event.preventDefault();
        moveActive(options.length - 1, -1);
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
        <FieldLabel htmlFor={ownId} id={labelId} required={required}>
          {label}
        </FieldLabel>
      )}

      <Button
        ref={triggerRef}
        disabled={disabled}
        /* Роль по шаблону «select-only combobox»: кнопка, открывающая
           список, объявляется combobox — иначе диктор скажет «кнопка», а
           не «список», и не сообщит выбранное значение как значение. */
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        /* Имя кнопки складывается из её содержимого — то есть из
           выбранного значения. Без подписи диктор объявит «Русский» и
           не скажет, что это язык. */
        aria-labelledby={label ? `${labelId} ${ownId}` : undefined}
        {...controlProps}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        variant="secondary"
        size={size}
        className={cn(
          /* Ведёт себя как поле, а не как основная кнопка: заливать
             выпадающий список фирменным цветом при наведении незачем. */
          'w-full justify-between text-left font-normal group hover:border-ink-3',
          open && 'border-brand ring-3 ring-brand-soft',
          isError && !open && 'border-danger'
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
        <SelectMenu
          anchorRef={triggerRef}
          id={listboxId}
          labelledBy={label ? labelId : undefined}
          menuRef={menuRef}
          onClose={closeMenu}
        >
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
        <FieldCaption id={captionId} isError={isError}>
          {caption}
        </FieldCaption>
      )}
    </div>
  );
});
