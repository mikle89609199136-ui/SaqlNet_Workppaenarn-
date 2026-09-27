import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkDevicePanel, QrOfferPanel } from '@/features/qr-login';
import { services } from '@/services/serviceContainer';
import { isPasskeyAvailable, type TBackupSlot } from '@/shared/crypto';
import {
  Banner,
  ConfirmDialog,
  Icon,
  ListGroup,
  ListIntro,
  ListItemButton,
  ListStaticItem,
  showToast,
} from '@/shared/ui';
import { useBackupState } from '../model/useBackupState';
import { CloudPasswordForm } from './CloudPasswordForm';
import { PasskeyOffer } from './PasskeyOffer';

type TPanel = 'password' | 'passkey' | 'device' | 'code' | null;

/**
 * Настройки → Аккаунт → Шифрование и устройства (#744, #745, #746).
 *
 * Здесь всё, что держит историю доступной на всех устройствах: облачный
 * пароль, запасной passkey и подключение нового устройства по QR.
 */
export function KeyBackupSettings() {
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

  const close = () => setPanel(null);

  /* Заголовок и «назад» к аккаунту — в шапке раздела настроек (#828).
     Открытое действие — карточка под вводным абзацем, закрывается своей
     кнопкой. */
  return (
    <>
      <ListIntro>
        {t(
          'keyBackup.settings.description',
          'Переписка зашифрована на ваших устройствах. Резервная копия ключей хранится на сервере зашифрованной — прочитать её можете только вы.'
        )}
      </ListIntro>

      {status !== 'ready' ? (
        <Banner icon="lock" tone="warn">
          {t('keyBackup.settings.notReady', 'Резервная копия на этом устройстве не открыта.')}
        </Banner>
      ) : panel === 'password' ? (
        <PanelCard
          onClose={close}
          title={t('keyBackup.settings.changePassword', 'Новый облачный пароль')}
        >
          <CloudPasswordForm
            onSubmit={async (password) => {
              await services.cryptoService.changeCloudPassword(password);
              showToast(
                'success',
                t('keyBackup.settings.passwordChanged', 'Облачный пароль изменён')
              );
              close();
            }}
            submitLabel={t('keyBackup.settings.savePassword', 'Сменить пароль')}
          />
        </PanelCard>
      ) : panel === 'passkey' ? (
        <PanelCard onClose={close} title={t('keyBackup.passkey.title', 'Добавить passkey?')}>
          <PasskeyOffer
            onDone={() => {
              close();
              loadSlots();
            }}
            skipLabel={t('cancel', 'Отмена')}
          />
        </PanelCard>
      ) : panel === 'device' ? (
        <PanelCard
          onClose={close}
          title={t('keyBackup.settings.linkDevice', 'Подключить устройство')}
        >
          <LinkDevicePanel onDone={close} />
        </PanelCard>
      ) : panel === 'code' ? (
        <PanelCard onClose={close} title={t('keyBackup.settings.loginCode', 'Код для входа')}>
          <QrOfferPanel onDone={close} />
        </PanelCard>
      ) : (
        <>
          <ListGroup title={t('keyBackup.settings.groupBackup', 'Резервная копия ключей')}>
            <ListStaticItem
              hint={t(
                'keyBackup.settings.passwordDescription',
                'Открывает историю на новом устройстве. Мы его не знаем и восстановить не можем.'
              )}
              icon="cloud"
              label={t('keyBackup.password.label', 'Облачный пароль')}
              trailing={
                <ListItemButton onClick={() => setPanel('password')}>
                  {t('keyBackup.settings.change', 'Сменить')}
                </ListItemButton>
              }
            />
            {isPasskeyAvailable() && (
              <ListStaticItem
                hint={
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
                icon="fingerprint"
                label="Passkey"
                trailing={
                  <ListItemButton
                    danger={hasPasskey}
                    onClick={() => (hasPasskey ? setAskRemovePasskey(true) : setPanel('passkey'))}
                  >
                    {hasPasskey
                      ? t('keyBackup.passkey.remove', 'Удалить')
                      : t('keyBackup.passkey.addShort', 'Добавить')}
                  </ListItemButton>
                }
              />
            )}
          </ListGroup>

          <ListGroup title={t('keyBackup.settings.groupDevice', 'Новое устройство')}>
            <ListStaticItem
              hint={t(
                'keyBackup.settings.linkDescription',
                'Войти на новом устройстве по QR-коду — без паролей, история переписки перенесётся сразу.'
              )}
              icon="qrCode"
              label={t('keyBackup.settings.linkDevice', 'Подключить устройство')}
              trailing={
                <ListItemButton onClick={() => setPanel('device')}>
                  {t('keyBackup.settings.connect', 'Подключить')}
                </ListItemButton>
              }
            />
            <ListStaticItem
              hint={t(
                'keyBackup.settings.loginCodeDescription',
                'Код, который сканирует новое устройство: удобно войти на телефоне, когда вы вошли на компьютере.'
              )}
              icon="smartphone"
              label={t('keyBackup.settings.loginCode', 'Код для входа')}
              trailing={
                <ListItemButton onClick={() => setPanel('code')}>
                  {t('keyBackup.settings.show', 'Показать')}
                </ListItemButton>
              }
            />
          </ListGroup>
        </>
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
    </>
  );
}

/** Открытое действие: карточка с заголовком и кнопкой закрытия. */
function PanelCard({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={title} className="rounded-dialog bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="m-0 text-title font-semibold text-ink">{title}</h3>
        <button
          aria-label={t('close', 'Закрыть')}
          className="flex size-9 shrink-0 items-center justify-center rounded-icon text-ink-3 hover:layer-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          onClick={onClose}
          type="button"
        >
          <Icon className="size-4.5 stroke-2" name="cross" />
        </button>
      </div>
      {children}
    </section>
  );
}
