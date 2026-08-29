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

  const trackSize = size === 'sm' ? 'w-8 h-5' : 'w-11 h-[26px]';
  const thumbSize = size === 'sm' ? 'h-[14px] w-[14px] peer-checked:translate-x-3' : 'h-5 w-5 peer-checked:translate-x-[18px]';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        className={cn(
          'flex items-center gap-3 w-fit',
          disabled ? 'cursor-not-allowed opacity-42' : 'cursor-pointer group'
        )}
      >
        <div className="relative flex">
          <input
            type="checkbox"
            className="peer sr-only"
            ref={ref}
            disabled={disabled}
            aria-describedby={caption ? captionId : undefined}
            aria-invalid={error ? true : undefined}
            required={required}
            {...rest}
          />
          <div
            className={cn(
              'rounded-full transition-colors duration-fast border',
              'bg-sheet-2 border-line',
              'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:outline-offset-2',
              'peer-checked:bg-brand peer-checked:border-brand',
              trackSize
            )}
          />
          <div
            className={cn(
              'absolute top-[3px] left-[3px] rounded-full transition-all duration-fast',
              'bg-ink-3 peer-checked:bg-white',
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
