import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListSwitchItem, showToast } from '@/shared/ui';
import {
  disablePush,
  enablePush,
  usePushStore,
  type TPushStatus,
} from '../model/pushNotifications';

/** Переключатель «На этом устройстве» в «Уведомлениях и звуках» (#882, #1083). */
export function PushSettingItem({
  enable = enablePush,
  disable = disablePush,
}: {
  enable?: () => Promise<unknown>;
  disable?: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const status = usePushStore((state) => state.status);
  const busy = usePushStore((state) => state.busy);
  const [pendingChecked, setPendingChecked] = useState<boolean | null>(null);

  const hints: Record<TPushStatus, string> = {
    on: t('push.setting.on', 'Сообщения и звонки, когда приложение закрыто'),
    off: t('push.setting.on', 'Сообщения и звонки, когда приложение закрыто'),
    denied: t('push.setting.denied', 'Запрещены в настройках браузера — разрешите там'),
    'needs-install': t(
      'push.setting.needsInstall',
      'На iPhone — после установки: «Поделиться» → «На экран «Домой»»'
    ),
    unsupported: t('push.setting.unsupported', 'Этот браузер не поддерживает push-уведомления'),
    unavailable: t('push.setting.unavailable', 'Сервер пока не отправляет push-уведомления'),
  };
  const switchable = status === 'on' || status === 'off';
  const checked = pendingChecked !== null ? pendingChecked : status === 'on';

  const handleToggle = async (nextChecked: boolean) => {
    setPendingChecked(nextChecked);
    try {
      if (nextChecked) {
        const result = await enable();
        const currentStatus = usePushStore.getState().status;
        if (result === 'on' || currentStatus === 'on') {
          showToast('success', t('settingsSaved', 'Настройки сохранены'));
        } else {
          showToast('error', t('toast.settingsFailed', 'Не удалось сохранить настройки'));
        }
      } else {
        await disable();
        const currentStatus = usePushStore.getState().status;
        if (currentStatus === 'off') {
          showToast('success', t('settingsSaved', 'Настройки сохранены'));
        } else {
          showToast('error', t('toast.settingsFailed', 'Не удалось сохранить настройки'));
        }
      }
    } catch {
      showToast('error', t('toast.settingsFailed', 'Не удалось сохранить настройки'));
    } finally {
      setPendingChecked(null);
    }
  };

  return (
    <ListSwitchItem
      checked={checked}
      disabled={!switchable || busy || pendingChecked !== null}
      hint={hints[status]}
      icon="bell"
      label={t('push.setting.label', 'На этом устройстве')}
      onChange={handleToggle}
    />
  );
}
