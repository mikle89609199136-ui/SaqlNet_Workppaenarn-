import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Icon, Spinner, showToast } from '@/shared/ui';
import { useQrLogin, type IQrLoginResult } from '../model/useQrLogin';
import { QrCode } from './QrCode';

interface Props {
  /**
   * Что делать, когда вошедшее устройство подтвердило вход. Ошибка из
   * обработчика показывается под кодом, а код обновляется.
   */
  onConfirmed: (result: IQrLoginResult) => Promise<void>;
}

/**
 * Код для входа с уже вошедшего устройства (#745).
 *
 * Камера телефона открывает ссылку из кода прямо в приложении. Для второго
 * браузера на том же компьютере или если камеры нет — ссылку можно
 * скопировать и вставить в «Подключить устройство».
 */
export function QrLoginPanel({ onConfirmed }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Ошибка пробрасывается дальше: по ней хук обновит код.
  const { status, link, restart } = useQrLogin(async (result) => {
    setFinishing(true);
    setError(null);
    try {
      await onConfirmed(result);
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setFinishing(false);
    }
  });

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast('success', t('qrLogin.copied', 'Ссылка скопирована'));
    } catch {
      showToast('error', t('qrLogin.copyFailed', 'Не удалось скопировать'));
    }
  }

  return (
    <div className="grid gap-4 text-left">
      <ol className="text-body grid list-decimal gap-1 pl-5 text-ink-2">
        <li>{t('qrLogin.step1', 'Откройте CraneApp на устройстве, где вы уже вошли')}</li>
        <li>
          {t(
            'qrLogin.step2',
            'Наведите на код камеру телефона или откройте «Настройки → Аккаунт → Шифрование и устройства → Подключить устройство»'
          )}
        </li>
        <li>{t('qrLogin.step3', 'Подтвердите вход — история переписки появится здесь')}</li>
      </ol>

      {status === 'error' && (
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

      {error && (
        <Banner icon="warning" tone="warn">
          {error}
        </Banner>
      )}

      {link && !finishing ? (
        <>
          <QrCode label={t('qrLogin.codeLabel', 'QR-код для входа')} value={link} />
          <Button className="w-full" onClick={copyLink} variant="secondary">
            <Icon name="copy" size="sm" />
            {t('qrLogin.copyLink', 'Скопировать ссылку')}
          </Button>
          <p className="text-caption text-center text-ink-3">
            {t('qrLogin.waiting', 'Ждём подтверждения… Код обновляется сам.')}
          </p>
        </>
      ) : (
        status !== 'error' && (
          <div className="flex justify-center py-10">
            <Spinner label={t('loading', 'Загрузка…')} size="lg" />
          </div>
        )
      )}
    </div>
  );
}
