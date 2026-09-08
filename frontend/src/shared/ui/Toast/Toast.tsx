import { Icon } from '@/shared/ui/Icon';
import type { TIconTypes } from '@/types';
import { cn } from '@/shared/lib';
import { useEffect, useRef, useState } from 'react';
import type { IToast } from './toastQueue';

/* Значок и цвет выводятся из вида, а не передаются вызывающим: иначе
   одна и та же ошибка в разных местах приходит то с крестиком, то с
   восклицательным знаком. */
const kinds = {
  success: { icon: 'checkCircle', color: 'text-ok', bar: 'bg-ok', role: 'status' },
  error: { icon: 'cross', color: 'text-danger', bar: 'bg-danger', role: 'alert' },
  warning: { icon: 'warning', color: 'text-warn', bar: 'bg-warn', role: 'alert' },
  info: { icon: 'info', color: 'text-brand', bar: 'bg-brand', role: 'status' },
} as const satisfies Record<
  IToast['type'],
  { icon: TIconTypes; color: string; bar: string; role: 'status' | 'alert' }
>;

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
        'pointer-events-auto relative flex items-center gap-3 overflow-hidden',
        'rounded-field border border-line bg-sheet-2 px-4 py-3 text-body text-ink',
        'shadow-[var(--elev-2)]',
        leaving
          ? 'animate-[toast-out_160ms_ease-in_forwards]'
          : 'animate-[toast-in_200ms_var(--ease-out)_both]',
        'motion-reduce:animate-none',
        toast.type === 'error' && 'border-danger/45'
      )}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={kind.role}
    >
      <Icon aria-hidden="true" className={cn('shrink-0', kind.color)} name={kind.icon} size="md" />
      <span>{toast.message}</span>

      {/* Полоса времени. Считает таймер выше, полоса лишь показывает —
          но встают они вместе: пауза останавливает и то и другое. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 bottom-0 h-0.5 origin-left',
          'animate-[toast-bar_linear_forwards] motion-reduce:animate-none',
          kind.bar
        )}
        style={{
          animationDuration: `${LIFETIME}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  );
};
