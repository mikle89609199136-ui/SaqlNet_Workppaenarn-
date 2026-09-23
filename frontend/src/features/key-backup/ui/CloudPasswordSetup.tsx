import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { services } from '@/services/serviceContainer';
import { forgetLoginPassword, isPasskeyAvailable } from '@/shared/crypto';
import { AuthLayout, Banner } from '@/shared/ui';
import { CloudPasswordForm } from './CloudPasswordForm';
import { PasskeyOffer } from './PasskeyOffer';

interface Props {
  /** На устройстве есть переписка прежней схемы: она уйдёт в копию (#747). */
  migrating: boolean;
  onDone: () => void;
  /** Пароль уходит на сохранение: копия вот-вот станет готовой, а мастер ещё не кончился. */
  onSaving?: () => void;
  footer?: ReactNode;
}

/**
 * Первая настройка резервной копии (#744).
 *
 * Показывается после регистрации и всем, у кого копии ещё нет. Без неё
 * переписка не откроется ни на одном другом устройстве, поэтому шаг
 * обязательный.
 */
export function CloudPasswordSetup({ migrating, onDone, onSaving, footer }: Props) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<'password' | 'passkey'>('password');

  async function setup(password: string) {
    onSaving?.();
    await services.cryptoService.setupBackup(password);
    forgetLoginPassword();

    if (isPasskeyAvailable()) {
      setStage('passkey');
      return;
    }
    onDone();
  }

  if (stage === 'passkey') {
    return (
      <AuthLayout
        footer={footer}
        subtitle={t('keyBackup.passkey.subtitle', 'Запасной способ открыть историю')}
        title={t('keyBackup.passkey.title', 'Добавить passkey?')}
      >
        <PasskeyOffer onDone={onDone} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      footer={footer}
      subtitle={t(
        'keyBackup.setup.subtitle',
        'Он откроет вашу переписку на любом устройстве. Мы его не знаем и восстановить не сможем.'
      )}
      title={t('keyBackup.setup.title', 'Облачный пароль')}
    >
      <div className="grid gap-4">
        {migrating && (
          <Banner icon="info" tone="info">
            {t(
              'keyBackup.setup.migrating',
              'Переписка с этого устройства будет сохранена в зашифрованную копию. Собеседники один раз увидят, что вы обновили ключи шифрования.'
            )}
          </Banner>
        )}
        <CloudPasswordForm
          onSubmit={setup}
          submitLabel={t('keyBackup.setup.submit', 'Сохранить')}
        />
      </div>
    </AuthLayout>
  );
}
