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
    <p className="text-caption text-center text-ink-3 tabular-nums">
      {seconds === null
        ? t('qrLogin.waiting', 'Ждём подтверждения… Код обновляется сам.')
        : t('qrLogin.rotatesIn', {
            defaultValue: 'Ждём подтверждения… Новый код через {{seconds}} с',
            seconds,
          })}
    </p>
  );
}
