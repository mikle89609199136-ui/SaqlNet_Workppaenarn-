import { FieldCaption, FieldLabel, useField } from '@/shared/ui/Field';
import { Icon } from '@/shared/ui/Icon';
import type { TIconTypes } from '@/types';
import { cn } from '@/shared/lib';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

/* Отступы подобраны так, чтобы поле и кнопка того же размера выходили
   одной высоты: они постоянно стоят в одной строке — поиск, форма с
   кнопкой отправки. Проверено замером: 31.6 / 44.1 / 52.9. */
const sizes = {
  sm: {
    field: 'text-caption px-3 py-1.5 rounded-control',
    icon: 'left-2.5',
    withIcon: 'pl-8',
    addon: 'right-1.5',
    withAddon: 'pr-9',
  },
  md: {
    field: 'text-body px-3.5 py-2.5 rounded-field',
    icon: 'left-3.5',
    withIcon: 'pl-10',
    addon: 'right-2',
    withAddon: 'pr-11',
  },
  lg: {
    field: 'text-title px-4 py-3.5 rounded-field',
    icon: 'left-4',
    withIcon: 'pl-11',
    addon: 'right-2.5',
    withAddon: 'pr-12',
  },
} as const;

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /* Подпись над полем. Кит показывает поля без неё, но тогда имя берётся
     из placeholder — а он исчезает, стоит начать печатать, и человек
     остаётся с полем без названия. Где подписи нет, нужен aria-label. */
  label?: string;
  /* Под полем. Ошибка вытесняет подсказку: показывать обе разом значит
     заставить читать две строки там, где важна одна. */
  hint?: string;
  error?: string;
  size?: keyof typeof sizes;
  /* Слева внутри поля, украшение — лупа в поиске. */
  icon?: TIconTypes;
  /* Справа внутри поля, что угодно: кнопка очистки, показ пароля,
     спиннер проверки юзернейма, галочка «свободен». Отступ поля
     подстраивается сам, чтобы текст не заезжал под содержимое. */
  addon?: ReactNode;
  className?: string;
  inputClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    label,
    hint,
    error,
    size = 'md',
    icon,
    addon,
    id,
    className,
    inputClassName,
    disabled,
    readOnly,
    required,
    ...rest
  },
  ref
) {
  const { fieldId, captionId, caption, isError, controlProps } = useField({ id, hint, error });
  const s = sizes[size];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <FieldLabel htmlFor={fieldId} required={required}>
          {label}
        </FieldLabel>
      )}

      <div className="relative flex items-center">
        {icon && (
          <Icon
            aria-hidden="true"
            className={cn('pointer-events-none absolute text-ink-3', s.icon)}
            name={icon}
            size="sm"
          />
        )}

        <input
          className={cn(
            'w-full border bg-ground text-ink transition-colors duration-fast',
            'placeholder:text-ink-3',
            /* Кольцо вместо смещённого контура, как у кнопки: у поля
               важно видеть, что печатать будут именно в него, и видно
               это должно быть при любом способе фокуса, не только с
               клавиатуры. */
            'focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand-soft',
            isError ? 'border-danger' : 'border-line hover:border-ink-3',
            'disabled:cursor-not-allowed disabled:opacity-42',
            /* Только для чтения — не ошибка и не запрет: поле живое, из
               него можно копировать, поэтому гасим лишь фон. */
            'read-only:bg-sheet-2 read-only:hover:border-line',
            s.field,
            icon && s.withIcon,
            addon && s.withAddon,
            inputClassName
          )}
          disabled={disabled}
          readOnly={readOnly}
          ref={ref}
          required={required}
          {...controlProps}
          {...rest}
        />

        {addon && <span className={cn('absolute flex items-center', s.addon)}>{addon}</span>}
      </div>

      {caption && (
        <FieldCaption id={captionId} isError={isError}>
          {caption}
        </FieldCaption>
      )}
    </div>
  );
});
