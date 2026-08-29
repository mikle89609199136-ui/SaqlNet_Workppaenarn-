import { ChoiceField, useField } from '@/components/ui/Field';
import { cn } from '@/utils';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  /* Вид ошибки без своей подписи: текст ошибки у группы один на всех,
     а покраснеть обязан каждый кружок. */
  invalid?: boolean;
  className?: string;
}

/* Одиночный переключатель. Взаимоисключение держится на общем name, и
   раздаёт его RadioGroup — им и пользуются на экранах. Отдельно этот
   компонент нужен там, где разметку группы приходится собирать руками. */
export const Radio = forwardRef<HTMLInputElement, Props>(function Radio(
  { label, hint, error, invalid, className, id, required, disabled, ...rest },
  ref
) {
  const { fieldId, captionId, caption, isError, controlProps } = useField({ id, hint, error });
  const showsError = isError || Boolean(invalid);

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
          ref={ref}
          required={required}
          type="radio"
          {...controlProps}
          {...rest}
        />
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-pill border-[1.5px] transition-colors duration-fast',
            'bg-ground',
            showsError ? 'border-danger' : 'border-line hover:border-ink-3',
            'peer-checked:border-brand-fill',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2',
            'after:size-2.5 after:scale-0 after:rounded-pill after:bg-brand-fill after:transition-transform after:duration-fast',
            'peer-checked:after:scale-100'
          )}
        />
      </span>
    </ChoiceField>
  );
});
