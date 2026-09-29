import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseQrLink, parseQrOfferLink, type IQrOfferLink } from '@/shared/crypto';
import { Banner, Button, Input, Icon } from '@/shared/ui';
import type { IQrLoginResult } from '../model/useQrLogin';
import { QrClaimPanel } from './QrClaimPanel';
import { QrScanner } from './QrScanner';

interface Props {
  onConfirmed: (result: IQrLoginResult) => Promise<void>;
}

/**
 * Новое устройство: отсканировать код, который показывает вошедшее (#754).
 *
 * Камера — основной путь; вставить ссылку можно, если входите во втором
 * браузере на том же компьютере.
 */
export function QrScanLoginPanel({ onConfirmed }: Props) {
  const { t } = useTranslation();
  const [link, setLink] = useState<IQrOfferLink | null>(null);
  const [scanning, setScanning] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function check(raw: string) {
    setScanning(false);
    const parsed = parseQrOfferLink(raw, window.location.origin);
    if (parsed) {
      setError(null);
      setLink(parsed);
      return;
    }
    // Код для другого направления: его показывает новое устройство.
    setError(
      parseQrLink(raw, window.location.origin)
        ? t(
            'qrClaim.wrongDirection',
            'Этот код показывает новое устройство — отсканируйте его на устройстве, где вы уже вошли.'
          )
        : t('qrLogin.invalidLink', 'Это не код входа в CraneApp')
    );
  }

  if (link) {
    return (
      <QrClaimPanel
        link={link}
        onConfirmed={onConfirmed}
        onRetry={() => {
          setLink(null);
          setScanning(true);
        }}
      />
    );
  }

  return (
    <div className="grid gap-4 text-left">
      <p className="text-body text-ink-2">
        {t(
          'qrClaim.hint',
          'На устройстве, где вы уже вошли, откройте «Настройки → Аккаунт → Шифрование и устройства → Код для входа» и отсканируйте код.'
        )}
      </p>

      {error && (
        <Banner icon="warning" tone="warn">
          {error}
        </Banner>
      )}

      {scanning ? (
        <QrScanner
          onResult={check}
          unavailableHint={t(
            'qrClaim.cameraUnavailable',
            'Камера недоступна. Скопируйте ссылку под кодом на вошедшем устройстве и вставьте её ниже.'
          )}
        />
      ) : (
        <Button className="w-full" onClick={() => setScanning(true)}>
          <Icon className="stroke-[1.8px]" name="camera" size="md" />
          {t('qrLogin.scan', 'Сканировать код')}
        </Button>
      )}
      <div aria-hidden="true" className="flex items-center gap-3 text-meta text-ink-3">
        <span className="h-px grow bg-divider" />
        {t('qrLogin.or', 'или')}
        <span className="h-px grow bg-divider" />
      </div>

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          check(text);
        }}
      >
        <Input
          autoCapitalize="none"
          autoCorrect="off"
          label={t('qrLogin.pasteLink', 'Вставьте ссылку из-под кода')}
          onChange={(event) => setText(event.target.value)}
          placeholder="https://…/qr-login#…"
          value={text}
        />
        <Button className="w-full" disabled={!text.trim()} type="submit" variant="secondary">
          {t('qrLogin.checkLink', 'Проверить')}
        </Button>
      </form>
    </div>
  );
}
