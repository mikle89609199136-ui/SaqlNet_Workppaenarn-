import { cn } from '@/utils';
import { forwardRef, useId, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const Switch = forwardRef<HTMLInputElement, Props>(function Switch(
  { label, hint, error, size = 'md', className, id, required, disabled, ...rest },
  ref
) {
  const ownId = useId();
  const fieldId = id ?? ownId;
  const captionId = `${fieldId}-caption`;
  const caption = error ?? hint;

  const trackSize = size === 'sm' ? 'w-8 h-4' : 'w-11 h-6';
  const thumbSize = size === 'sm' ? 'h-3 w-3 peer-checked:translate-x-4' : 'h-5 w-5 peer-checked:translate-x-5';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        className={cn(
          'flex items-center gap-3 w-fit',
          disabled ? 'cursor-not-allowed opacity-42' : 'cursor-pointer group'
        )}
        htmlFor={fieldId}
      >
        <div className="relative flex">
          <input
            type="checkbox"
            className="peer sr-only"
            id={fieldId}
            ref={ref}
            disabled={disabled}
            aria-describedby={caption ? captionId : undefined}
            aria-invalid={error ? true : undefined}
            required={required}
            {...rest}
          />
          <div
            className={cn(
              'rounded-full transition-colors duration-fast bg-sheet-3',
              'peer-focus-visible:ring-3 peer-focus-visible:ring-brand-soft',
              'peer-checked:bg-brand',
              trackSize
            )}
          />
          <div
            className={cn(
              'absolute top-0.5 left-0.5 bg-white rounded-full transition-transform duration-fast shadow-sm',
              thumbSize
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
});
