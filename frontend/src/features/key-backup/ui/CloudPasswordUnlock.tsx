import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { services } from '@/services/serviceContainer';
import {
  evaluatePasskeySlots,
  isPasskeyAvailable,
  PasskeyCancelledError,
  PasskeyNotAllowedHereError,
  PasskeyPrfUnsupportedError,
  WrongCloudPasswordError,
} from '@/shared/crypto';
import { AuthLayout, Banner, Button, ConfirmDialog, Icon } from '@/shared/ui';
import { CloudPasswordInput } from './CloudPasswordInput';

interface Props {
  hasPasskey: boolean;
  onDone: () => void;
  footer?: ReactNode;
  /**
   * Вход по коду с уже вошедшего устройства. Панель QR — чужая фича, её
   * подставляет тот, кто собирает экран (#863); принятый ключ она отдаёт
   * в onKey.
   */
  renderQrLogin: (onKey: (masterKey: Uint8Array<ArrayBuffer> | null) => Promise<void>) => ReactNode;
}

type TView = 'password' | 'qr' | 'forgot';

/**
 * Открыть резервную копию на этом устройстве (#744).
 *
 * Три способа, и ни один не проходит через сервер в открытом виде:
 * облачный пароль, passkey и подтверждение с уже вошедшего устройства.
 * Сброс — последнее средство, и экран говорит о его цене прямо.
 */
export function CloudPasswordUnlock({ hasPasskey, onDone, footer, renderQrLogin }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<TView>('password');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askReset, setAskReset] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (caught) {
      if (caught instanceof WrongCloudPasswordError) {
        setError(t('keyBackup.unlock.wrongPassword', 'Неверный облачный пароль'));
      } else if (caught instanceof PasskeyCancelledError) {
        // Причину браузер не называет: закрыли окно, вышло время или
        // passkey сохранён в другом браузере — подсказываем все сразу.
        setError(
          t(
            'keyBackup.passkey.cancelled',
            'Passkey не сработал: окно закрыли, время вышло или в этом браузере нет passkey для CraneApp. Если он сохранён на другом устройстве или в другом браузере, откройте историю облачным паролем.'
          )
        );
      } else if (caught instanceof PasskeyNotAllowedHereError) {
        setError(
          t(
            'keyBackup.passkey.notAllowedHere',
            'На этом адресе passkey не работает. Откройте CraneApp по обычному адресу или введите облачный пароль.'
          )
        );
      } else if (caught instanceof PasskeyPrfUnsupportedError) {
        setError(
          t(
            'keyBackup.passkey.unsupported',
            'Этот passkey не подходит для восстановления копии. Попробуйте другой способ хранения ключей — например, менеджер паролей Google или iCloud.'
          )
        );
      } else {
        // Текст ошибки браузера — английский и для разработчика.
        setError(
          caught instanceof DOMException
            ? t('keyBackup.unlock.failed', 'Не удалось открыть копию')
            : (caught as Error).message || t('keyBackup.unlock.failed', 'Не удалось открыть копию')
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    void run(() => services.cryptoService.unlockWithPassword(password));
  }

  const title =
    view === 'qr'
      ? t('keyBackup.unlock.qrTitle', 'Вход через другое устройство')
      : view === 'forgot'
        ? t('keyBackup.unlock.forgotTitle', 'Забыли облачный пароль?')
        : t('keyBackup.unlock.title', 'Откройте историю переписки');

  return (
    <AuthLayout
      footer={footer}
      icon={view === 'forgot' ? 'warning' : 'lock'}
      subtitle={
        view === 'password'
          ? t(
              'keyBackup.unlock.subtitle',
              'Переписка зашифрована. Чтобы прочитать её на этом устройстве, введите облачный пароль.'
            )
          : undefined
      }
      title={title}
      wide={view === 'qr'}
    >
      {view === 'qr' && (
        <div className="grid gap-4">
          {renderQrLogin(async (masterKey) => {
            if (!masterKey) throw new Error(t('qrLogin.noKey', 'Устройство не передало ключ'));
            await services.cryptoService.acceptMasterKey(masterKey);
            onDone();
          })}
          <Button className="w-full text-brand" onClick={() => setView('password')} variant="ghost">
            {t('back', 'Назад')}
          </Button>
        </div>
      )}

      {view === 'forgot' && (
        <div className="grid gap-4 text-left">
          <p className="text-body text-ink-2">
            {t(
              'keyBackup.forgot.otherDevice',
              'Если вы вошли на другом устройстве — войдите здесь через него по QR-коду или задайте там новый облачный пароль: «Настройки → Аккаунт → Шифрование и устройства».'
            )}
          </p>
          {hasPasskey && (
            <p className="text-body text-ink-2">
              {t('keyBackup.forgot.passkey', 'Если вы добавляли passkey — откройте копию им.')}
            </p>
          )}
          <Banner
            className="bg-danger-soft text-caption font-semibold text-ink"
            icon="warning"
            role="status"
            tone="danger"
          >
            {t(
              'keyBackup.forgot.resetWarning',
              'Если ничего из этого нет, копию можно только сбросить. Переписка, сохранённая в ней, пропадёт на всех устройствах: восстановить её не сможем ни мы, ни кто-либо ещё.'
            )}
          </Banner>
          <Button className="w-full" onClick={() => setView('qr')} variant="secondary">
            {t('keyBackup.unlock.viaQr', 'Войти через другое устройство')}
          </Button>
          <Button className="w-full" onClick={() => setAskReset(true)} variant="danger">
            {t('keyBackup.forgot.reset', 'Сбросить копию')}
          </Button>
          <Button className="w-full text-brand" onClick={() => setView('password')} variant="ghost">
            {t('back', 'Назад')}
          </Button>
        </div>
      )}

      {view === 'password' && (
        <div className="grid gap-4">
          {error && (
            <Banner icon="warning" tone="warn">
              {error}
            </Banner>
          )}

          <form className="grid gap-4 text-left" noValidate onSubmit={submitPassword}>
            <CloudPasswordInput
              autoComplete="current-password"
              autoFocus
              label={t('keyBackup.password.label', 'Облачный пароль')}
              onChange={(event) => setPassword(event.target.value)}
              value={password}
            />
            <Button className="w-full" disabled={!password} loading={busy} type="submit">
              {t('keyBackup.unlock.submit', 'Открыть')}
            </Button>
          </form>

          {hasPasskey && isPasskeyAvailable() && (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() =>
                run(() => services.cryptoService.unlockWithPasskey(evaluatePasskeySlots))
              }
              variant="secondary"
            >
              <Icon className="stroke-[1.8px]" name="fingerprint" size="md" />
              {t('keyBackup.unlock.passkey', 'Открыть с passkey')}
            </Button>
          )}

          <Button
            className="w-full"
            disabled={busy}
            onClick={() => setView('qr')}
            variant="secondary"
          >
            <Icon className="stroke-[1.8px]" name="qrCode" size="md" />
            {t('keyBackup.unlock.viaQr', 'Войти через другое устройство')}
          </Button>

          <Button
            className="w-full text-brand"
            disabled={busy}
            onClick={() => setView('forgot')}
            variant="ghost"
          >
            {t('keyBackup.unlock.forgot', 'Забыли облачный пароль?')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        confirmLabel={t('keyBackup.forgot.resetConfirm', 'Сбросить и потерять историю')}
        confirming={busy}
        onCancel={() => setAskReset(false)}
        onConfirm={() =>
          void run(async () => {
            await services.cryptoService.resetBackup();
            setAskReset(false);
          })
        }
        open={askReset}
        title={t('keyBackup.forgot.resetTitle', 'Сбросить резервную копию?')}
      >
        {t(
          'keyBackup.forgot.resetBody',
          'Переписка из копии станет недоступна на всех ваших устройствах. Новые сообщения будут сохраняться в новую копию под новым облачным паролем.'
        )}
      </ConfirmDialog>
    </AuthLayout>
  );
}
