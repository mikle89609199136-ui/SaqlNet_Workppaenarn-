import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import {
  createPasskeySlot,
  PasskeyCancelledError,
  PasskeyNotAllowedHereError,
  PasskeyPrfUnsupportedError,
  registerPasskey,
} from '@/shared/crypto';
import { Banner, Button } from '@/shared/ui';

interface Props {
  onDone: () => void;
  /** Подпись кнопки «не сейчас»: в мастере — «Позже», в настройках — «Отмена». */
  skipLabel?: string;
}

/**
 * Добавить passkey к резервной копии (#746).
 *
 * Passkey хранит платформа — iCloud Keychain, Google Password Manager,
 * Windows Hello — и сама переносит его на новые устройства. Поэтому он и
 * спасает, когда облачный пароль забыт: открыть копию можно отпечатком
 * пальца или лицом.
 */
export function PasskeyOffer({ onDone, skipLabel }: Props) {
  const { t } = useTranslation();
  const user = useProfileStore((state) => state.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPasskey() {
    if (!user?.id) return;

    setBusy(true);
    setError(null);
    try {
      const master = services.cryptoService.currentMasterKey();
      if (!master) throw new Error('Резервная копия на этом устройстве не открыта');

      const registration = await registerPasskey({
        id: user.id,
        username: user.username || user.id,
        displayName:
          [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'CraneApp',
      });
      const slot = await createPasskeySlot(
        master,
        registration.credentialId,
        registration.prfSalt,
        registration.prfOutput
      );
      await services.cryptoService.addPasskeySlot(slot);
      onDone();
    } catch (caught) {
      // Окно закрыли сами — ошибкой это не считаем.
      if (caught instanceof PasskeyCancelledError) return;
      setError(
        caught instanceof PasskeyNotAllowedHereError
          ? t(
              'keyBackup.passkey.notAllowedHere',
              'На этом адресе passkey не работает. Откройте CraneApp по обычному адресу или введите облачный пароль.'
            )
          : caught instanceof PasskeyPrfUnsupportedError
            ? t(
                'keyBackup.passkey.unsupported',
                'Этот passkey не подходит для восстановления копии. Попробуйте другой способ хранения ключей — например, менеджер паролей Google или iCloud.'
              )
            : t('keyBackup.passkey.failed', 'Не удалось добавить passkey')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 text-left">
      <p className="text-body text-ink-2">
        {t(
          'keyBackup.passkey.offer',
          'Если забудете облачный пароль, историю можно будет открыть отпечатком пальца или лицом. Passkey хранится в вашем менеджере паролей и переходит на новые устройства сам.'
        )}
      </p>

      {error && (
        <Banner icon="warning" tone="warn">
          {error}
        </Banner>
      )}

      <Button className="w-full" loading={busy} onClick={addPasskey}>
        {t('keyBackup.passkey.add', 'Добавить passkey')}
      </Button>
      <Button className="w-full" disabled={busy} onClick={onDone} variant="ghost">
        {skipLabel ?? t('keyBackup.passkey.later', 'Позже')}
      </Button>
    </div>
  );
}
