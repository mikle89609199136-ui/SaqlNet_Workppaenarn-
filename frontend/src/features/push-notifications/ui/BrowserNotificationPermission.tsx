import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListStaticItem } from '@/shared/ui';

function readPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Доступ к fallback при недоступном Web Push. Разрешение — только по явному нажатию. */
export function BrowserNotificationPermission() {
  const { t } = useTranslation();
  const [permission, setPermission] = useState(readPermission);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const refresh = () => setPermission(readPermission());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const hints = {
    granted: t('settings.notifications.permissionGranted', 'Системные уведомления разрешены'),
    denied: t(
      'settings.notifications.permissionDenied',
      'Запрещены браузером. Измените разрешение в настройках сайта.'
    ),
    default: t(
      'settings.notifications.permissionDefault',
      'Для оповещений в фоне, пока приложение открыто'
    ),
    unsupported: t(
      'settings.notifications.permissionUnsupported',
      'Системные уведомления недоступны в этом браузере'
    ),
  };
  return (
    <ListStaticItem
      icon="bell"
      label={t('settings.notifications.browserPermission', 'Разрешение браузера')}
      hint={hints[permission]}
      trailing={
        permission === 'default' ? (
          <Button
            disabled={pending}
            onClick={() => {
              // До первого await: разрешение запрашивается непосредственно из жеста пользователя.
              const requested = Notification.requestPermission();
              setPending(true);
              void requested
                .then(setPermission)
                .catch(() => setPermission(readPermission()))
                .finally(() => setPending(false));
            }}
          >
            {t('settings.notifications.allowPermission', 'Разрешить')}
          </Button>
        ) : undefined
      }
    />
  );
}
