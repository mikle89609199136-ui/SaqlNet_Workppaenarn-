import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { services } from '@/services/serviceContainer';
import { disconnectRealtimeSocket } from '@/shared/api';
import { REACT_ROUTES } from '@/shared/config';
import { AuthLayout, Banner, Button, Spinner } from '@/shared/ui';
import { useBackupState } from '../model/useBackupState';
import { CloudPasswordSetup } from './CloudPasswordSetup';
import { CloudPasswordUnlock } from './CloudPasswordUnlock';

interface Props {
  children: ReactNode;
  /**
   * Очистить сессию на устройстве при выходе с заслонки. Это сценарий
   * входа и выхода, а не резервной копии, — его передаёт приложение (#863).
   */
  onSignOut: () => void;
  /**
   * Вход по коду с уже вошедшего устройства. Панель QR — чужая фича, её
   * подставляет тот, кто собирает экран (#863); принятый ключ она отдаёт
   * в onKey.
   */
  renderQrLogin: (onKey: (masterKey: Uint8Array<ArrayBuffer> | null) => Promise<void>) => ReactNode;
}

/**
 * Заслонка перед приложением, пока ключи шифрования не готовы (#744).
 *
 * Без ключей переписка всё равно не читается и не отправляется, поэтому
 * лучше честно попросить облачный пароль, чем показать ленту из замков.
 * Когда шифрование в окружении невозможно вовсе (нет WebCrypto), заслонки
 * нет: об этом говорит сам чат, как и раньше.
 */
export function KeyBackupGate({ children, onSignOut, renderQrLogin }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status, hasPasskey, migrating } = useBackupState();

  /* Настройка — это два шага: пароль и предложение passkey. Копия готова
     уже после первого, но экран должен дожить до конца мастера. */
  const [settingUp, setSettingUp] = useState(false);

  useEffect(() => {
    /* Подготовку запускает точка входа, но только если сессия уже лежала
       в хранилище. Вошедшему иначе заслонка не должна крутиться вечно. */
    if (status === 'checking') void services.cryptoService.init().catch(() => {});
  }, [status]);

  function finish() {
    setSettingUp(false);
    // Всё, что успело загрузиться под замком, расшифровываем заново.
    void queryClient.invalidateQueries();
  }

  async function logout() {
    await services.authService.logout().catch(() => {});
    disconnectRealtimeSocket();
    queryClient.clear();
    onSignOut();
    navigate(REACT_ROUTES.LOGIN, { replace: true });
  }

  const footer = (
    <button
      className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
      onClick={logout}
      type="button"
    >
      {t('settings.account.logout', 'Выйти из аккаунта')}
    </button>
  );

  if (status === 'needsSetup' || (settingUp && status === 'ready')) {
    return (
      <CloudPasswordSetup
        footer={footer}
        migrating={migrating}
        onDone={finish}
        onSaving={() => setSettingUp(true)}
      />
    );
  }

  if (status === 'locked') {
    return (
      <CloudPasswordUnlock
        footer={footer}
        hasPasskey={hasPasskey}
        onDone={finish}
        renderQrLogin={renderQrLogin}
      />
    );
  }

  if (status === 'checking') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-ground">
        <Spinner label={t('keyBackup.checking', 'Проверяем ключи шифрования…')} size="lg" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <AuthLayout footer={footer} icon="wifiOff" title={t('keyBackup.error.title', 'Нет связи')}>
        <div className="grid gap-4">
          <Banner icon="warning" tone="warn">
            {t(
              'keyBackup.error.body',
              'Не удалось проверить ключи шифрования. Проверьте подключение и попробуйте снова.'
            )}
          </Banner>
          <Button
            className="w-full"
            onClick={() => void services.cryptoService.init().catch(() => {})}
          >
            {t('qrLogin.retry', 'Повторить')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return <>{children}</>;
}
