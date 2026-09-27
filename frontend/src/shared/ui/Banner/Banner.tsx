import { Icon } from '@/shared/ui/Icon';
import type { TIconTypes } from '@/types';
import { cn } from '@/shared/lib';
import type { ReactNode } from 'react';

/* Плашка дизайн-системы (#817): без рамки, на мягкой подложке своего
   вида; сведения — на приподнятой поверхности. Значок несёт цвет вида,
   текст остаётся нейтральным: полужирное начало говорит, что случилось,
   продолжение — почему. */
const tones = {
  info: {
    box: 'bg-sheet-2',
    icon: 'text-brand',
    defaultIcon: 'info',
  },
  warn: {
    box: 'bg-warn-soft',
    icon: 'text-warn',
    defaultIcon: 'warning',
  },
  danger: {
    box: 'bg-danger-soft',
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
        'flex min-h-13.5 items-center gap-3 rounded-dialog px-4 py-3 text-ui leading-[1.4] text-ink-2',
        '[&_b]:font-semibold [&_b]:text-ink [&_strong]:font-semibold [&_strong]:text-ink',
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
