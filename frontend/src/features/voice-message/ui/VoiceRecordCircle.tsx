import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';

interface Props {
  /** Громкость последних отсчётов, 0…1: кольцо вокруг круга дышит голосом. */
  level: number;
  /** Смещение пальца влево, px (≤ 0): круг едет за пальцем к отмене. */
  offsetX?: number;
  /** Запись закреплена: круг — кнопка «Отправить». */
  locked?: boolean;
  sending?: boolean;
  onSend?: () => void;
}

/**
 * Большой круг записи поверх кнопки микрофона — как в Telegram (#843),
 * только для касаний. Пока держат палец — микрофон, круг не ловит нажатия:
 * жест ведёт кнопка под ним. Закрепили — круг сам становится «Отправить»,
 * крупной целью для пальца.
 */
export function VoiceRecordCircle({ level, offsetX = 0, locked = false, sending, onSend }: Props) {
  const { t } = useTranslation();
  const ring = 1 + Math.min(1, Math.max(0, level)) * 0.45;

  return (
    <span
      className="absolute top-1/2 left-1/2 z-10 size-18 -translate-x-1/2 -translate-y-1/2 animate-[voice-circle-in_160ms_ease-out] motion-reduce:animate-none"
      data-voice-circle={locked ? 'send' : 'recording'}
      style={{ transform: `translateX(${Math.min(0, offsetX)}px)` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-pill bg-brand-fill/20 transition-transform duration-100 ease-out motion-reduce:transition-none"
        data-voice-ring
        style={{ transform: `scale(${ring})` }}
      />
      {locked ? (
        <button
          aria-label={t('voice.send', 'Отправить голосовое')}
          className="relative flex size-full cursor-pointer items-center justify-center rounded-pill bg-brand-fill text-on-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          disabled={sending}
          onClick={onSend}
          type="button"
        >
          <Icon className="size-6 stroke-2" name="send" />
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none relative flex size-full items-center justify-center rounded-pill bg-brand-fill text-on-brand"
        >
          <Icon className="size-6.5 stroke-2" name="mic" />
        </span>
      )}
    </span>
  );
}
