import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkDevicePanel, QrOfferPanel } from '@/features/qr-login';
import { services } from '@/services/serviceContainer';
import { isPasskeyAvailable, type TBackupSlot } from '@/shared/crypto';
import { Banner, Button, ConfirmDialog, Icon, showToast } from '@/shared/ui';
import { useBackupState } from '../model/useBackupState';
import { CloudPasswordForm } from './CloudPasswordForm';
import { PasskeyOffer } from './PasskeyOffer';

interface Props {
  onBack: () => void;
}

type TPanel = 'password' | 'passkey' | 'device' | 'code' | null;

/**
 * Настройки → Аккаунт → Шифрование и устройства (#744, #745, #746).
 *
 * Здесь всё, что держит историю доступной на всех устройствах: облачный
 * пароль, запасной passkey и подключение нового устройства по QR.
 */
export function KeyBackupSettings({ onBack }: Props) {
  const { t } = useTranslation();
  const { status } = useBackupState();
  const [panel, setPanel] = useState<TPanel>(null);
  const [slots, setSlots] = useState<TBackupSlot[] | null>(null);
  const [askRemovePasskey, setAskRemovePasskey] = useState(false);
  const [removing, setRemoving] = useState(false);

  const loadSlots = useCallback(() => {
    services.cryptoService
      .backupSlots()
      .then(setSlots)
      .catch(() => setSlots([]));
  }, []);

  useEffect(() => {
    if (status === 'ready') loadSlots();
  }, [status, loadSlots]);

  const hasPasskey = Boolean(slots?.some((slot) => slot.type === 'passkey'));

  async function removePasskey() {
    setRemoving(true);
    try {
      await services.cryptoService.removePasskeySlots();
      showToast('success', t('keyBackup.passkey.removed', 'Passkey удалён из копии'));
      loadSlots();
    } catch {
      showToast('error', t('keyBackup.passkey.removeFailed', 'Не удалось удалить passkey'));
    } finally {
      setRemoving(false);
      setAskRemovePasskey(false);
    }
  }

  return (
    <section>
      <button
        className="text-caption -ml-2 mb-3 flex items-center gap-1 rounded-control px-2 py-1 text-ink-2 transition-colors duration-fast hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        onClick={panel ? () => setPanel(null) : onBack}
        type="button"
      >
        <Icon className="rotate-180" name="chevronRight" size="sm" />
        {t('back', 'Назад')}
      </button>

      <header className="mb-4">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">
          {t('keyBackup.settings.title', 'Шифрование и устройства')}
        </h1>
        <p className="text-caption text-ink-2">
          {t(
            'keyBackup.settings.description',
            'Переписка зашифрована на ваших устройствах. Резервная копия ключей хранится на сервере зашифрованной — прочитать её можете только вы.'
          )}
        </p>
      </header>

      {status !== 'ready' ? (
        <Banner icon="lock" tone="warn">
          {t('keyBackup.settings.notReady', 'Резервная копия на этом устройстве не открыта.')}
        </Banner>
      ) : panel === 'password' ? (
        <SettingsCard title={t('keyBackup.settings.changePassword', 'Новый облачный пароль')}>
          <CloudPasswordForm
            onSubmit={async (password) => {
              await services.cryptoService.changeCloudPassword(password);
              showToast(
                'success',
                t('keyBackup.settings.passwordChanged', 'Облачный пароль изменён')
              );
              setPanel(null);
            }}
            submitLabel={t('keyBackup.settings.savePassword', 'Сменить пароль')}
          />
        </SettingsCard>
      ) : panel === 'passkey' ? (
        <SettingsCard title={t('keyBackup.passkey.title', 'Добавить passkey?')}>
          <PasskeyOffer
            onDone={() => {
              setPanel(null);
              loadSlots();
            }}
            skipLabel={t('cancel', 'Отмена')}
          />
        </SettingsCard>
      ) : panel === 'device' ? (
        <SettingsCard title={t('keyBackup.settings.linkDevice', 'Подключить устройство')}>
          <LinkDevicePanel onDone={() => setPanel(null)} />
        </SettingsCard>
      ) : panel === 'code' ? (
        <SettingsCard title={t('keyBackup.settings.loginCode', 'Код для входа')}>
          <QrOfferPanel onDone={() => setPanel(null)} />
        </SettingsCard>
      ) : (
        <div className="grid gap-4">
          <Banner icon="shield" tone="info">
            {t(
              'keyBackup.settings.enabled',
              'Резервная копия включена: история переписки доступна на всех устройствах, где вы вошли.'
            )}
          </Banner>

          <div className="divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
            <SettingsRow
              action={t('keyBackup.settings.change', 'Сменить')}
              description={t(
                'keyBackup.settings.passwordDescription',
                'Открывает историю на новом устройстве. Мы его не знаем и восстановить не можем.'
              )}
              onClick={() => setPanel('password')}
              title={t('keyBackup.password.label', 'Облачный пароль')}
            />
            {isPasskeyAvailable() && (
              <SettingsRow
                action={
                  hasPasskey
                    ? t('keyBackup.passkey.remove', 'Удалить')
                    : t('keyBackup.passkey.add', 'Добавить passkey')
                }
                description={
                  hasPasskey
                    ? t(
                        'keyBackup.passkey.enabled',
                        'Добавлен: если забудете облачный пароль, откройте копию им.'
                      )
                    : t(
                        'keyBackup.passkey.disabled',
                        'Запасной способ открыть историю без облачного пароля.'
                      )
                }
                onClick={() => (hasPasskey ? setAskRemovePasskey(true) : setPanel('passkey'))}
                title="Passkey"
              />
            )}
            <SettingsRow
              action={t('keyBackup.settings.connect', 'Подключить')}
              description={t(
                'keyBackup.settings.linkDescription',
                'Войти на новом устройстве по QR-коду — без паролей, история переписки перенесётся сразу.'
              )}
              onClick={() => setPanel('device')}
              title={t('keyBackup.settings.linkDevice', 'Подключить устройство')}
            />
            <SettingsRow
              action={t('keyBackup.settings.show', 'Показать')}
              description={t(
                'keyBackup.settings.loginCodeDescription',
                'Код, который сканирует новое устройство: удобно войти на телефоне, когда вы вошли на компьютере.'
              )}
              onClick={() => setPanel('code')}
              title={t('keyBackup.settings.loginCode', 'Код для входа')}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        confirmLabel={t('keyBackup.passkey.remove', 'Удалить')}
        confirming={removing}
        onCancel={() => setAskRemovePasskey(false)}
        onConfirm={removePasskey}
        open={askRemovePasskey}
        title={t('keyBackup.passkey.removeTitle', 'Удалить passkey из копии?')}
      >
        {t(
          'keyBackup.passkey.removeBody',
          'Открыть историю на новом устройстве можно будет только облачным паролем или через уже вошедшее устройство.'
        )}
      </ConfirmDialog>
    </section>
  );
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-bubble border border-line bg-sheet p-5">
      <h2 className="text-title mb-4 font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}

interface ISettingsRowProps {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}

function SettingsRow({ title, description, action, onClick }: ISettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <strong className="text-body block text-ink">{title}</strong>
        <span className="text-caption text-ink-2">{description}</span>
      </div>
      <Button className="shrink-0" onClick={onClick} size="sm" variant="secondary">
        {action}
      </Button>
    </div>
  );
}
