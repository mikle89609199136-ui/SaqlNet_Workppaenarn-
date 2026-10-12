import { useTranslation } from 'react-i18next';
import { ListSwitchItem } from '@/shared/ui';
import {
  disablePush,
  enablePush,
  usePushStore,
  type TPushStatus,
} from '../model/pushNotifications';

/** Переключатель «На этом устройстве» в «Уведомлениях и звуках» (#882). */
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

  return (
    <ListSwitchItem
      checked={status === 'on'}
      disabled={!switchable || busy}
      hint={hints[status]}
      icon="bell"
      label={t('push.setting.label', 'На этом устройстве')}
      onChange={(checked) => void (checked ? enable() : disable())}
    />
  );
}
