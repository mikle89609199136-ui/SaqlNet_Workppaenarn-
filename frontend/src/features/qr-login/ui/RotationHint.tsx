import { useTranslation } from 'react-i18next';
import { useSecondsLeft } from '../model/useSecondsLeft';

interface Props {
  /** Когда код на экране сменится; `null` — код ещё не получен. */
  rotatesAt: number | null;
}

/**
 * Обратный отсчёт под кодом (#753). Без него смена кода выглядит как
 * сбой: человек навёл камеру, а картинка поменялась.
 */
export function RotationHint({ rotatesAt }: Props) {
  const { t } = useTranslation();
  const seconds = useSecondsLeft(rotatesAt);

  return (
    <p className="m-0 text-center text-caption text-ink-3 tabular-nums">
      {seconds === null
        ? t('qrLogin.waiting', 'Код обновляется сам')
        : t('qrLogin.rotatesInTime', {
            defaultValue: 'Код обновится через {{time}}',
            time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
          })}
    </p>
  );
}
