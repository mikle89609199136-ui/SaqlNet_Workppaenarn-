import { Button } from '@/shared/ui/Button';
import { FieldCaption, FieldLabel, useField } from '@/shared/ui/Field';
import { Icon } from '@/shared/ui/Icon';
import type { TIconTypes } from '@/types';
import { cn } from '@/shared/lib';
import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/* md — поле формы дизайн-системы (#817): 48px, скругление кнопки.
   Высота набирается отступом, интерлиньяжем и рамкой: 12 + 22 + 12 + 2.
   sm — поиск и поля в плотных панелях, lg — крупный ввод кодов. */
const sizes = {
  sm: {
    field: 'text-caption px-3 py-1.5 rounded-field',
    icon: 'left-2.5',
    withIcon: 'pl-8',
    addon: 'right-1',
    withAddon: 'pr-9',
  },
  md: {
    field: 'text-body px-4 py-3 rounded-button',
    icon: 'left-4',
    withIcon: 'pl-11',
    addon: 'right-1',
    withAddon: 'pr-12',
  },
  /* Поиск над списком (#819): 42px — 10 + 20 + 10 + рамка, значок 18. */
  search: {
    field: 'text-ui px-3.5 py-2.5 rounded-icon',
    icon: 'left-3.5 size-4.5',
    withIcon: 'pl-10.5',
    addon: 'right-1',
    withAddon: 'pr-10',
  },
  lg: {
    field: 'text-title px-4 py-3.5 rounded-button',
    icon: 'left-4',
    withIcon: 'pl-11',
    addon: 'right-1.5',
    withAddon: 'pr-13',
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
  /* «Необязательно» в подписи. */
  optional?: boolean;
  size?: keyof typeof sizes;
  /* Слева внутри поля, украшение — лупа в поиске. */
  icon?: TIconTypes;
  /* Слева внутри поля, текстом — «@» у имени пользователя (#827). */
  prefix?: string;
  /* Справа внутри поля, что угодно: кнопка очистки, показ пароля,
     спиннер проверки юзернейма, галочка «свободен». Отступ поля
     подстраивается сам, чтобы текст не заезжал под содержимое. */
  addon?: ReactNode;
  /* У поля пароля — кнопка-глаз справа. Включена по умолчанию: пароль,
     который нельзя проверить глазами, набирают вслепую и ошибаются.
     Свой addon её заменяет. */
  revealable?: boolean;
  className?: string;
  inputClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    label,
    hint,
    error,
    optional,
    size = 'md',
    icon,
    prefix,
    addon,
    id,
    className,
    inputClassName,
    disabled,
    readOnly,
    required,
    revealable = true,
    type,
    ...rest
  },
  ref
) {
  const { t } = useTranslation();
  const { fieldId, captionId, caption, isError, controlProps } = useField({ id, hint, error });
  const [revealed, setRevealed] = useState(false);
  const s = sizes[size];

  const isPassword = type === 'password';
  const eye =
    isPassword && revealable && !addon ? (
      <Button
        aria-label={
          revealed ? t('hidePassword', 'Скрыть пароль') : t('showPassword', 'Показать пароль')
        }
        className={cn('rounded-field', revealed ? 'text-brand' : 'text-ink-3')}
        disabled={disabled}
        iconOnly
        onClick={() => setRevealed((value) => !value)}
        size={size === 'sm' ? 'sm' : 'md'}
        variant="ghost"
      >
        <Icon name={revealed ? 'eyeOff' : 'eye'} size="md" />
      </Button>
    ) : null;
  const trailing = addon ?? eye;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <FieldLabel htmlFor={fieldId} optional={optional} required={required}>
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

        {prefix && !icon && (
          <span
            aria-hidden="true"
            className={cn('pointer-events-none absolute text-body text-ink-3', s.icon)}
          >
            {prefix}
          </span>
        )}

        <input
          className={cn(
            /* Поле узнаётся по фону ленты на панели и по рамке —
               декоративной линии дизайн-системы. */
            'w-full border bg-chat-bg text-ink transition-[border-color,box-shadow] duration-fast',
            'placeholder:text-ink-3',
            /* Кольцо вместо смещённого контура, как у кнопки: у поля
               важно видеть, что печатать будут именно в него, и видно
               это должно быть при любом способе фокуса, не только с
               клавиатуры. */
            'focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand-soft',
            isError ? 'border-danger' : 'border-divider',
            'disabled:cursor-not-allowed disabled:opacity-42',
            /* Только для чтения — не ошибка и не запрет: поле живое, из
               него можно копировать, поэтому гасим лишь фон. */
            'read-only:bg-sheet-2',
            /* Скрыть нативный крестик очистки в браузерах WebKit/Blink (#1082) */
            '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden',
            '[&::-webkit-search-decoration]:appearance-none',
            s.field,
            (icon || prefix) && s.withIcon,
            trailing && s.withAddon,
            inputClassName
          )}
          disabled={disabled}
          readOnly={readOnly}
          ref={ref}
          required={required}
          type={isPassword && revealed ? 'text' : type}
          {...controlProps}
          {...rest}
        />

        {trailing && <span className={cn('absolute flex items-center', s.addon)}>{trailing}</span>}
      </div>

      {caption && (
        <FieldCaption id={captionId} isError={isError}>
          {caption}
        </FieldCaption>
      )}
    </div>
  );
});
