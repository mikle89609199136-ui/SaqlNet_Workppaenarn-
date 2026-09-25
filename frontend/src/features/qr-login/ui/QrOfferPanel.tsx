import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { readBackupState, subscribeToBackupState } from '@/shared/crypto';
import { Banner, Button, Icon, Spinner, showToast } from '@/shared/ui';
import { useQrOffer } from '../model/useQrOffer';
import { QrCode } from './QrCode';
import { QrCodeLayout } from './QrCodeLayout';
import { RotationHint } from './RotationHint';

interface Props {
  onDone?: () => void;
}

/**
 * Код для входа нового устройства на вошедшем (#754).
 *
 * Новое устройство сканирует его камерой — удобно, когда вошли на
 * компьютере, а входить нужно на телефоне. Вход только после
 * подтверждения здесь, и прежде человек сверяет четыре цифры с экраном
 * нового устройства: код могли сфотографировать через плечо и
 * отсканировать раньше него.
 */
export function QrOfferPanel({ onDone }: Props) {
  const { t } = useTranslation();
  // Мастер-ключ передаётся только из открытой копии, и код без неё не
  // показываем вовсе: подтвердить его всё равно было бы нечем.
  const backup = useSyncExternalStore(subscribeToBackupState, readBackupState, readBackupState);

  if (backup.status !== 'ready') {
    return (
      <Banner icon="lock" tone="warn">
        {t(
          'qrLogin.lockedHere',
          'На этом устройстве резервная копия ещё не открыта — подключать с него другие нельзя. Сначала введите облачный пароль.'
        )}
      </Banner>
    );
  }

  return <OfferCode onDone={onDone} />;
}

function OfferCode({ onDone }: Props) {
  const { t } = useTranslation();
  const { stage, link, rotatesAt, claim, problem, confirm, decline, restart } = useQrOffer();

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast('success', t('qrLogin.copied', 'Ссылка скопирована'));
    } catch {
      showToast('error', t('qrLogin.copyFailed', 'Не удалось скопировать'));
    }
  }

  if (stage === 'done') {
    return (
      <div className="grid gap-4 text-center">
        <Icon className="mx-auto size-10 text-ok" name="checkCircle" />
        <p className="text-body text-ink">
          {t('qrLogin.done', 'Готово: новое устройство вошло, история переписки уже там.')}
        </p>
        {onDone && (
          <Button className="w-full" onClick={onDone} variant="secondary">
            {t('done', 'Готово')}
          </Button>
        )}
      </div>
    );
  }

  if ((stage === 'claimed' || stage === 'sending') && claim) {
    return (
      <div className="grid gap-4 text-left">
        <p className="text-body text-ink">
          {t('qrOffer.claimQuestion', 'Код отсканировало устройство:')}
        </p>
        <div className="rounded-field border border-line bg-sheet-2 p-4">
          <strong className="text-body block text-ink">
            {claim.deviceName || claim.userAgent}
          </strong>
        </div>
        <div className="grid justify-items-center gap-1 text-center">
          <span className="text-caption text-ink-2">
            {t('qrOffer.compareCode', 'Сверьте цифры с экраном нового устройства')}
          </span>
          <strong
            aria-label={t('qrOffer.verificationCode', 'Код сверки')}
            className="font-mono text-[32px] leading-none font-semibold tracking-[0.3em] text-ink tabular-nums"
          >
            {claim.verificationCode}
          </strong>
        </div>
        <Banner icon="warning" tone="warn">
          {t(
            'qrOffer.mismatchWarning',
            'Цифры не совпадают или вы не сканировали код сами — отклоните. Иначе чужое устройство получит доступ к вашей переписке.'
          )}
        </Banner>
        <Button className="w-full" loading={stage === 'sending'} onClick={confirm}>
          {t('qrOffer.confirm', 'Цифры совпадают — впустить')}
        </Button>
        <Button className="w-full" disabled={stage === 'sending'} onClick={decline} variant="ghost">
          {t('qrOffer.decline', 'Отклонить')}
        </Button>
      </div>
    );
  }

  return (
    <QrCodeLayout
      actions={
        link && (
          <>
            <Button className="w-full" onClick={copyLink} variant="secondary">
              <Icon name="copy" size="sm" />
              {t('qrLogin.copyLink', 'Скопировать ссылку')}
            </Button>
            <RotationHint rotatesAt={rotatesAt} />
          </>
        )
      }
      code={
        link ? (
          <QrCode
            label={t('qrOffer.codeLabel', 'QR-код для входа на новом устройстве')}
            value={link}
          />
        ) : (
          stage !== 'error' && (
            <div className="flex justify-center py-10">
              <Spinner label={t('loading', 'Загрузка…')} size="lg" />
            </div>
          )
        )
      }
      intro={
        <>
          <ol className="text-body grid list-decimal gap-1 pl-5 text-ink-2">
            <li>
              {t(
                'qrOffer.step1',
                'На новом устройстве откройте CraneApp → «Войти» → «QR-код» → «Отсканировать код с другого устройства» или наведите на код камеру телефона'
              )}
            </li>
            <li>
              {t('qrOffer.step2', 'Сверьте четыре цифры на обоих экранах и подтвердите вход здесь')}
            </li>
          </ol>

          {problem === 'tampered' && (
            <Banner icon="warning" tone="danger">
              {t(
                'qrOffer.tampered',
                'Ключ нового устройства пришёл без верной подписи — код мог быть подменён. Вход отклонён, показан новый код.'
              )}
            </Banner>
          )}
          {problem === 'confirmFailed' && (
            <Banner icon="warning" tone="warn">
              {t(
                'qrLogin.confirmFailed',
                'Не удалось подтвердить вход. Обновите код и попробуйте ещё раз.'
              )}
            </Banner>
          )}

          {stage === 'error' && (
            <Banner
              action={
                <Button onClick={restart} size="sm" variant="secondary">
                  {t('qrLogin.retry', 'Повторить')}
                </Button>
              }
              icon="warning"
              tone="warn"
            >
              {t('qrLogin.startFailed', 'Не удалось получить код')}
            </Banner>
          )}
        </>
      }
    />
  );
}
