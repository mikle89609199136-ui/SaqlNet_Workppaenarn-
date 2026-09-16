import { ChoiceField, useField } from '@/shared/ui/Field';
import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';
import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  /* Третье состояние: отмечена часть. Нужно там, где один флажок
     управляет группой — заголовок выбора нескольких сообщений при трёх
     отмеченных из двенадцати обязан показывать именно его, иначе
     выглядит снятым и клик по нему отметит всё вместо снятия. */
  indeterminate?: boolean;
  className?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox(
  { label, hint, error, indeterminate, className, id, required, disabled, ...rest },
  ref
) {
  const { fieldId, captionId, caption, isError, controlProps } = useField({ id, hint, error });
  const own = useRef<HTMLInputElement>(null);

  /* indeterminate — свойство узла, а не атрибут: разметкой его не
     выставить, только присвоением. */
  useEffect(() => {
    if (own.current) own.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <ChoiceField
      caption={caption}
      captionId={captionId}
      className={className}
      fieldId={fieldId}
      isError={isError}
      label={label}
      required={required}
    >
      <span className="flex">
        <input
          className="peer sr-only"
          disabled={disabled}
          ref={(node) => {
            own.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          required={required}
          type="checkbox"
          {...controlProps}
          {...rest}
        />
        {/* Заливка — brand-fill, знак поверх неё — on-brand. Пара
            неразрывна: brand в тёмной теме подменяется на светлый
            вариант, и белый знак на нём даёт 2,66:1 при норме 3:1, а на
            янтарном акценте — 2:1. */}
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-control border-[1.5px] transition-colors duration-fast',
            'bg-ground text-transparent',
            isError ? 'border-danger' : 'border-line hover:border-ink-3',
            'peer-checked:border-brand-fill peer-checked:bg-brand-fill peer-checked:text-on-brand',
            'peer-indeterminate:border-brand-fill peer-indeterminate:bg-brand-fill peer-indeterminate:text-on-brand',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2'
          )}
        >
          {indeterminate ? (
            <span className="h-[2px] w-2.5 rounded-pill bg-current" />
          ) : (
            <Icon className="stroke-[2.5px]" name="check" size="sm" />
          )}
        </span>
      </span>
    </ChoiceField>
  );
});
