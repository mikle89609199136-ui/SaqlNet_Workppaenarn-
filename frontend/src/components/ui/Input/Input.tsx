import { Icon } from '@/components/ui/Icon/Icon';
import type { TIconTypes } from '@/types';
import { cn } from '@/utils';
import { forwardRef, useId, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /* Подпись над полем. Кит показывает поля без неё, но тогда имя берётся
     из placeholder — а он исчезает, стоит начать печатать, и человек
     остаётся с полем без названия. Где подписи нет, нужен aria-label. */
  label?: string;
  /* Под полем. Ошибка вытесняет подсказку: показывать обе разом значит
     заставить читать две строки там, где важна одна. */
  hint?: string;
  error?: string;
  /* Слева внутри поля — нужен строке поиска. */
  icon?: TIconTypes;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, icon, id, className, disabled, readOnly, ...rest },
  ref
) {
  const ownId = useId();
  const fieldId = id ?? ownId;
  const captionId = `${fieldId}-caption`;
  const caption = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-caption font-medium text-ink-2" htmlFor={fieldId}>
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        {icon && (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 text-ink-3"
            name={icon}
            size="sm"
          />
        )}

        <input
          aria-describedby={caption ? captionId : undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            'w-full rounded-field border bg-ground px-3.5 py-2.5 text-body text-ink',
            'transition-colors duration-fast placeholder:text-ink-3',
            /* Кольцо вместо смещённого контура, как у кнопки: у поля
               важно видеть, что печатать будут именно в него, и видно
               это должно быть при любом способе фокуса, не только с
               клавиатуры. */
            'focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand-soft',
            error ? 'border-danger' : 'border-line hover:border-ink-3',
            'disabled:cursor-not-allowed disabled:opacity-42',
            /* Только для чтения — не ошибка и не запрет: поле живое, из
               него можно копировать, поэтому гасим лишь фон. */
            'read-only:bg-sheet-2 read-only:hover:border-line',
            icon && 'pl-10',
            className
          )}
          disabled={disabled}
          id={fieldId}
          readOnly={readOnly}
          ref={ref}
          {...rest}
        />
      </div>

      {caption && (
        <p className={cn('text-caption', error ? 'text-danger' : 'text-ink-3')} id={captionId}>
          {caption}
        </p>
      )}
    </div>
  );
});
