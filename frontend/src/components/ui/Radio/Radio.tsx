import { FieldCaption, useField } from '@/components/ui/Field';
import { cn } from '@/utils';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
}

export const Radio = forwardRef<HTMLInputElement, Props>(function Radio(
  { label, hint, error, className, id, required, disabled, ...rest },
  ref
) {
  const { fieldId, captionId, caption, isError, controlProps } = useField({ id, hint, error });

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        className={cn(
          'flex items-center gap-3 w-fit',
          disabled ? 'cursor-not-allowed opacity-42' : 'cursor-pointer group'
        )}
        htmlFor={fieldId}
      >
        <div className="relative flex items-center justify-center">
          <input
            type="radio"
            className="peer sr-only"
            ref={ref}
            disabled={disabled}
            required={required}
            {...controlProps}
            {...rest}
          />
          <div
            className={cn(
              'w-5 h-5 flex-shrink-0 border-[1.5px] rounded-full transition-colors duration-fast flex items-center justify-center',
              'bg-ground border-line',
              'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2',
              'peer-checked:border-brand',
              'after:content-[""] after:w-2.5 after:h-2.5 after:rounded-full after:bg-brand after:scale-0 peer-checked:after:scale-100 after:transition-transform after:duration-fast'
            )}
          />
        </div>

        {label && (
          <span className="text-body font-medium text-ink-2 select-none">
            {label}
            {required && (
              <span aria-hidden="true" className="text-danger">
                {' *'}
              </span>
            )}
          </span>
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
