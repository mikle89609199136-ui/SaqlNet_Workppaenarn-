import { ChoiceField, useField } from '@/shared/ui/Field';
import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';
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
      <span className="relative flex">
        <input
          className="peer sr-only"
          disabled={disabled}
          ref={ref}
          required={required}
          type="radio"
          {...controlProps}
          {...rest}
        />
        {/* Кружок 22 с рамкой 2px; выбранный залит акцентом и несёт
            белую галочку (дизайн-система, #817). */}
        <span
          className={cn(
            'flex size-5.5 shrink-0 items-center justify-center rounded-pill border-2 transition-colors duration-fast',
            showsError ? 'border-danger' : 'border-ink-3',
            'peer-checked:border-brand-fill peer-checked:bg-brand-fill',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2'
          )}
        />
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 size-3.5 -translate-1/2 scale-0 text-on-brand transition-transform duration-fast peer-checked:scale-100"
          name="check"
        />
      </span>
    </ChoiceField>
  );
});
