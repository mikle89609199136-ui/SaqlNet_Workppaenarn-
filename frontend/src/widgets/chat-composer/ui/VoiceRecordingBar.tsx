import { cn } from '@/shared/lib';
import { Button, Icon } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

interface Props {
  /** Сколько идёт запись, в секундах. */
  seconds: number;
  /**
   * Запись закреплена смахиванием вверх: палец можно отпустить, слева
   * появляется «отменить», в середине — живая волна.
   */
  locked: boolean;
  /** Громкость по последним отсчётам, 0…1, — высоты столбиков волны. */
  levels?: number[];
  /**
   * Насколько далеко смахнули влево, 0…1: подсказка «влево — отмена»
   * уезжает и гаснет. Только пока палец держит кнопку.
   */
  cancelProgress?: number;
  onCancel?: () => void;
}

const LOCKED_BARS = 40;

function formatTimer(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Полоса записи голосового вместо поля ввода — по макету (#821).
 *
 * Только вид: запись и отправку делает #843, до неё вход (кнопка
 * микрофона) не показывается. Пока держат кнопку — мигающая точка, таймер и
 * подсказка «‹ Влево — отмена»; закреплённая запись — корзина, таймер и
 * волна.
 */
export function VoiceRecordingBar({
  seconds,
  locked,
  levels = [],
  cancelProgress = 0,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const bars = Array.from(
    { length: LOCKED_BARS },
    (_, index) => levels[levels.length - LOCKED_BARS + index] ?? 0
  );

  return (
    <div
      aria-label={t('voice.recording', 'Запись голосового')}
      className={cn('flex h-10 min-w-0 flex-1 items-center gap-2.5', !locked && 'pl-3')}
      role="group"
    >
      {locked && onCancel && (
        <Button
          aria-label={t('voice.cancel', 'Отменить запись')}
          className="text-danger"
          iconOnly
          onClick={onCancel}
          variant="ghost"
        >
          <Icon className="size-5" name="trash" />
        </Button>
      )}

      <span className="flex min-w-16 shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-pill bg-rec animate-[rec-pulse_1s_ease-in-out_infinite] motion-reduce:animate-none"
        />
        <span aria-live="off" className="text-body text-ink tabular-nums">
          {formatTimer(seconds)}
        </span>
      </span>

      {locked ? (
        <span
          aria-hidden="true"
          className="flex h-8 min-w-0 flex-1 items-center gap-0.75 overflow-hidden"
        >
          {bars.map((level, index) => (
            <span
              className="w-[3px] shrink-0 rounded-[2px] bg-brand"
              key={index}
              style={{ height: 4 + Math.round(Math.min(1, Math.max(0, level)) * 24) }}
            />
          ))}
        </span>
      ) : (
        <span
          className="min-w-0 flex-1 pr-3 text-right text-caption whitespace-nowrap text-ink-3"
          style={{
            opacity: 1 - cancelProgress,
            transform: `translateX(${-cancelProgress * 40}px)`,
          }}
        >
          {t('voice.slideToCancel', '‹ Влево — отмена')}
        </span>
      )}
    </div>
  );
}
