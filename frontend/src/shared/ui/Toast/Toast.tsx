import { Icon } from '@/shared/ui/Icon';
import type { TIconTypes } from '@/types';
import { cn } from '@/shared/lib';
import { useEffect, useRef, useState } from 'react';
import type { IToast } from './toastQueue';

/* Значок выводится из вида, а не передаётся вызывающим: иначе одна и та
   же ошибка в разных местах приходит то с крестиком, то с
   восклицательным знаком.

   Уведомление дизайн-системы (#817) — тёмная таблетка на светлой теме и
   светлая на тёмной, цвет текста на ней один. Подтверждению значок не
   нужен: «Ссылка скопирована» и так понятна. У ошибки и предупреждения
   он остаётся — того же цвета, что текст: статусные цвета на
   перевёрнутом фоне не держат контраст. */
const kinds = {
  success: { icon: null, role: 'status' },
  error: { icon: 'cross', role: 'alert' },
  warning: { icon: 'warning', role: 'alert' },
  info: { icon: null, role: 'status' },
} as const satisfies Record<IToast['type'], { icon: TIconTypes | null; role: 'status' | 'alert' }>;

const LIFETIME = 3000;
/* Столько уведомление живёт после решения закрыться — ровно чтобы
   доиграла анимация ухода. */
const LEAVING = 160;

interface Props {
  toast: IToast;
  onHide: (id: string) => void;
}

export const Toast = ({ toast, onHide }: Props) => {
  const kind = kinds[toast.type];
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /* Сколько осталось. Пауза не сбрасывает отсчёт, а замораживает его:
     иначе наведение продлевало бы жизнь уведомления каждый раз заново. */
  const left = useRef(LIFETIME);

  useEffect(() => {
    if (paused || leaving) return;

    const startedAt = Date.now();
    const timer = setTimeout(() => setLeaving(true), left.current);

    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - startedAt;
    };
  }, [paused, leaving]);

  useEffect(() => {
    if (!leaving) return;

    const timer = setTimeout(() => onHide(toast.id), LEAVING);

    return () => clearTimeout(timer);
  }, [leaving, onHide, toast.id]);

  return (
    <div
      className={cn(
        /* Скругление окна, а не таблетка: в одну строку оно и выглядит
           таблеткой, а длинная ошибка в две строки не становится овалом. */
        'pointer-events-auto flex max-w-full items-center gap-2 rounded-window',
        'bg-ink px-3.5 py-2 text-caption text-sheet',
        leaving
          ? 'animate-[toast-out_160ms_ease-in_forwards]'
          : 'animate-[toast-in_200ms_var(--ease-out)_both]',
        'motion-reduce:animate-none'
      )}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={kind.role}
    >
      {kind.icon && <Icon aria-hidden="true" className="shrink-0" name={kind.icon} size="sm" />}
      <span>{toast.message}</span>
    </div>
  );
};
