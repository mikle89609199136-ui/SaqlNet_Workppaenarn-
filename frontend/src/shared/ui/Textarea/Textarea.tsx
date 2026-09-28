import { FieldCaption, FieldLabel, useField } from '@/shared/ui/Field';
import { cn } from '@/shared/lib';
import { forwardRef, useState, type TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
  textareaClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  {
    label,
    hint,
    error,
    id,
    className,
    textareaClassName,
    disabled,
    readOnly,
    required,
    maxLength,
    rows = 3,
    value,
    defaultValue,
    onChange,
    ...rest
  },
  ref
) {
  /* Счётчик считает сам, чтобы работать и в неуправляемом режиме: там
     значения снаружи нет вовсе, а знать длину надо. */
  const [own, setOwn] = useState(() => String(defaultValue ?? '').length);
  const length = value === undefined ? own : String(value).length;

  const counterId = maxLength ? `${id ?? 'ta'}-counter` : undefined;
  const { fieldId, captionId, caption, isError, controlProps } = useField({
    id,
    hint,
    error,
    /* Счётчик попадает в описание поля: диктор прочитает предел один раз
       при фокусе и не будет повторять его на каждом нажатии. */
    describedBy: counterId ? [counterId] : [],
  });

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <FieldLabel htmlFor={fieldId} required={required}>
          {label}
        </FieldLabel>
      )}

      <textarea
        className={cn(
          'w-full rounded-button border bg-chat-bg px-4 py-3 text-body text-ink',
          'transition-colors duration-fast placeholder:text-ink-3',
          /* Только по вертикали: вбок область растягивать некуда — она
             и так во всю ширину, а рывок вширь ломает раскладку. */
          'resize-y',
          'focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand-soft',
          isError ? 'border-danger' : 'border-divider',
          'disabled:cursor-not-allowed disabled:opacity-42',
          'read-only:bg-sheet-2',
          textareaClassName
        )}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(event) => {
          if (value === undefined) setOwn(event.target.value.length);
          onChange?.(event);
        }}
        readOnly={readOnly}
        ref={ref}
        required={required}
        rows={rows}
        {...controlProps}
        {...(value === undefined ? { defaultValue } : { value })}
        {...rest}
      />

      <div className="flex items-start justify-between gap-3">
        {caption ? (
          <FieldCaption id={captionId} isError={isError}>
            {caption}
          </FieldCaption>
        ) : (
          <span />
        )}

        {counterId && (
          <p
            className={cn(
              'shrink-0 text-caption tabular-nums',
              /* У предела счётчик краснеет: до этого человек узнавал о
                 лимите, только упёршись в него. */
              length >= (maxLength ?? 0) ? 'text-danger' : 'text-ink-3'
            )}
            id={counterId}
          >
            {length} / {maxLength}
          </p>
        )}
      </div>
    </div>
  );
});
