import { cn } from '@/shared/lib';
import { Icon } from '@/shared/ui';

interface Props {
  /** Насколько подняли палец к замку, 0…1. */
  progress?: number;
  /** Запись закреплена: замок закрыт и горит акцентом, пока идёт запись. */
  locked?: boolean;
}

/**
 * Замок над кругом записи — как в Telegram (#843), только для касаний:
 * мышью щелчок и так сразу закрепляет запись.
 *
 * Пока держат палец — плашка с приоткрытым замком и стрелкой «вверх»;
 * палец поднимается — плашка едет следом, стрелка гаснет, дужка опускается.
 * Закрепили — плашка сжимается до закрытого замка акцентного цвета и
 * остаётся, пока идёт запись: видно, что палец можно не держать.
 */
export function VoiceLockHint({ progress = 0, locked = false }: Props) {
  const lift = locked ? 0 : 1 - Math.min(1, Math.max(0, progress));

  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute bottom-16.5 left-0 flex w-10 flex-col items-center rounded-pill',
        'border border-divider bg-menu shadow-[var(--shadow-menu)]',
        'transition-[height,padding,translate] duration-fast',
        locked ? 'h-10 justify-center text-brand' : 'h-23 justify-between pt-3 pb-2.5 text-ink-2'
      )}
      data-lock={locked ? 'locked' : 'open'}
      style={{ translate: locked ? undefined : `0 ${-(1 - lift) * 24}px` }}
    >
      <svg
        className="size-4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <rect height="10" rx="2" width="14" x="5" y="11" />
        {/* Дужка приподнята, пока не закрепили, и опускается к подъёму пальца. */}
        <path
          className="transition-transform duration-fast"
          d="M8 11V7a4 4 0 0 1 8 0v4"
          data-shackle
          style={{ transform: `translateY(${-lift * 3}px)` }}
        />
      </svg>
      {!locked && (
        // Подпрыгивает обёртка, а не сама стрелка: анимация меняет transform
        // и перетёрла бы её поворот.
        <span
          className="flex animate-[lock-bounce_1s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{ opacity: lift }}
        >
          <Icon className="size-4 rotate-180 stroke-[2.2px] text-ink-3" name="chevronDown" />
        </span>
      )}
    </span>
  );
}
