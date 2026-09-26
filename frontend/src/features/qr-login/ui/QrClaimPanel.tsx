import { useTranslation } from 'react-i18next';
import type { IQrOfferLink } from '@/shared/crypto';
import { Banner, Button, Spinner } from '@/shared/ui';
import { useQrClaim, type TQrClaimProblem } from '../model/useQrClaim';
import type { IQrLoginResult } from '../model/useQrLogin';

interface Props {
  link: IQrOfferLink;
  onConfirmed: (result: IQrLoginResult) => Promise<void>;
  /** Отсканировать заново — после ошибки. */
  onRetry: () => void;
}

/**
 * Новое устройство отсканировало код с вошедшего (#754) и ждёт, пока там
 * сверят цифры и подтвердят вход.
 */
export function QrClaimPanel({ link, onConfirmed, onRetry }: Props) {
  const { t } = useTranslation();
  const { stage, verificationCode, problem } = useQrClaim(link, onConfirmed);

  const problems: Record<TQrClaimProblem, string> = {
    rotated: t('qrLogin.rotated', 'Код обновился — отсканируйте ещё раз.'),
    unavailable: t(
      'qrClaim.unavailable',
      'Код истёк или его уже отсканировали. Если это были не вы — не подтверждайте вход на вошедшем устройстве.'
    ),
    declined: t(
      'qrClaim.declined',
      'Вход не подтвердили: его отклонили или время вышло. Отсканируйте новый код.'
    ),
    error: t('qrClaim.error', 'Не удалось войти. Отсканируйте код ещё раз.'),
  };

  if (stage === 'failed' && problem) {
    return (
      <div className="grid animate-fade-in gap-4 text-left" key="failed">
        <Banner icon="warning" tone="warn">
          {problems[problem]}
        </Banner>
        <Button className="w-full" onClick={onRetry}>
          {t('qrClaim.scanAgain', 'Сканировать снова')}
        </Button>
      </div>
    );
  }

  if (stage === 'waiting' && verificationCode) {
    return (
      <div className="grid animate-fade-in justify-items-center gap-4 text-center" key="waiting">
        <span className="text-caption text-ink-2">
          {t('qrOffer.verificationCode', 'Код сверки')}
        </span>
        <strong className="font-mono text-[32px] leading-none font-semibold tracking-[0.3em] text-ink tabular-nums">
          {verificationCode}
        </strong>
        <p className="text-body text-ink">
          {t(
            'qrClaim.waiting',
            'Проверьте, что на вошедшем устройстве те же цифры, и подтвердите вход там.'
          )}
        </p>
        <Spinner label={t('qrClaim.waitingLabel', 'Ждём подтверждения')} size="md" />
      </div>
    );
  }

  return (
    <div className="flex animate-fade-in justify-center py-10" key="busy">
      <Spinner
        label={
          stage === 'finishing'
            ? t('qrClaim.finishing', 'Входим…')
            : t('qrLogin.checking', 'Проверяем код…')
        }
        size="lg"
      />
    </div>
  );
}
