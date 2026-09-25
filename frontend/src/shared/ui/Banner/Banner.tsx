import { Icon } from '@/shared/ui/Icon';
import type { TIconTypes } from '@/shared/types';
import { cn } from '@/shared/lib';
import type { ReactNode } from 'react';

/* Подложка и рамка — прозрачность от статусного токена, а не свой оттенок:
   так плашка следует за темой и за сменой акцента. */
const tones = {
  info: {
    box: 'border-brand-fill/35 bg-brand-soft',
    icon: 'text-brand',
    defaultIcon: 'info',
  },
  warn: {
    box: 'border-warn/40 bg-warn/10',
    icon: 'text-warn',
    defaultIcon: 'warning',
  },
  danger: {
    box: 'border-danger/40 bg-danger/10',
    icon: 'text-danger',
    defaultIcon: 'warning',
  },
} as const satisfies Record<string, { box: string; icon: string; defaultIcon: TIconTypes }>;

interface Props {
  children: ReactNode;
  tone?: keyof typeof tones;
  /* Значок по умолчанию отвечает виду плашки; передают свой там, где он
     говорит точнее — ключ у смены кода безопасности, щит у шифрования. */
  icon?: TIconTypes;
  /* Кнопка рядом с текстом: «Понятно», «Подтвердить код». */
  action?: ReactNode;
  className?: string;
}

export function Banner({ action, children, className, icon, tone = 'info' }: Props) {
  const style = tones[tone];

  return (
    <div
      className={cn(
        'text-body flex items-center gap-3 rounded-field border px-4 py-3.5 leading-normal text-ink',
        style.box,
        className
      )}
      /* Опасное объявляется сразу, остальное ждёт паузы в речи диктора:
         предупреждение о подписи перебивать человека вправе, сообщение о
         включённом шифровании — нет. */
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {/* Значок повторяет то, что уже сказано текстом и цветом. */}
      <Icon
        aria-hidden="true"
        className={cn('shrink-0', style.icon)}
        name={icon ?? style.defaultIcon}
        size="sm"
      />

      <div className="min-w-0 flex-1">{children}</div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
