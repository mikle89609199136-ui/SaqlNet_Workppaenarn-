import { FieldCaption, FieldLabel, useField } from '@/shared/ui/Field';
import { cn } from '@/shared/lib';
import { forwardRef, type InputHTMLAttributes } from 'react';

/* Дорожка и бегунок из кита: 44x26 и 20 у обычного размера. */
const sizes = {
  sm: { track: 'w-8 h-5', thumb: 'size-3.5 peer-checked:translate-x-3' },
  md: { track: 'w-11 h-6.5', thumb: 'size-5 peer-checked:translate-x-4.5' },
} as const;

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'role'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: keyof typeof sizes;
  className?: string;
}

export const Switch = forwardRef<HTMLInputElement, Props>(function Switch(
  { label, hint, error, size = 'md', className, id, required, disabled, checked, ...rest },
  ref
) {
  const { fieldId, captionId, caption, isError, controlProps } = useField({ id, hint, error });
  const s = sizes[size];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        className={cn(
          'flex w-fit items-center gap-3',
          disabled ? 'cursor-not-allowed opacity-42' : 'cursor-pointer'
        )}
        htmlFor={fieldId}
      >
        <span className="relative flex">
          <input
            checked={checked}
            className="peer sr-only"
            disabled={disabled}
            ref={ref}
            required={required}
            /* Переключатель, а не флажок: флажок — это выбор в форме,
               которую ещё надо отправить, а переключатель применяется
               сразу. Без роли диктор объявит его флажком, и человек
               будет ждать кнопки «Сохранить», которой нет. */
            role="switch"
            type="checkbox"
            {...controlProps}
            {...rest}
          />
          <span
            className={cn(
              'rounded-pill border border-line bg-sheet-2 transition-colors duration-fast',
              'peer-checked:border-brand-fill peer-checked:bg-brand-fill',
              'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2',
              isError && 'border-danger',
              s.track
            )}
          />
          <span
            className={cn(
              'absolute top-[3px] left-[3px] rounded-pill bg-ink-3 transition-all duration-fast',
              'peer-checked:bg-on-brand',
              s.thumb
            )}
          />
        </span>

        {label && (
          <FieldLabel htmlFor={fieldId} required={required}>
            <span className="text-body">{label}</span>
          </FieldLabel>
        )}
      </label>

      {caption && (
        <FieldCaption id={captionId} isError={isError}>
          {caption}
        </FieldCaption>
      )}
    </div>
  );
});
