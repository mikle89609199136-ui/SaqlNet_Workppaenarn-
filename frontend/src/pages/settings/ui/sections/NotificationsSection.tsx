import { useTranslation } from 'react-i18next';
import { ListGroup, ListSwitchItem } from '@/shared/ui';
import { useSettingsData } from './useSettingsData';

/** «Уведомления и звуки» — два переключателя, как в макете (#828). */
export function NotificationsSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();

  return (
    <ListGroup>
      <ListSwitchItem
        checked={settings.notifications}
        hint={t('settings.notifications.enabledHint', 'Показывать, когда приходят новые сообщения')}
        icon="bell"
        label={t('settings.notifications.enabled', 'Уведомления')}
        onChange={(checked) => saveSettings({ notifications: checked })}
      />
      <ListSwitchItem
        checked={settings.sounds}
        hint={t('settings.notifications.soundsHint', 'Звук при входящем сообщении')}
        icon="volume"
        label={t('settings.notifications.sounds', 'Звуки сообщений')}
        onChange={(checked) => saveSettings({ sounds: checked })}
      />
    </ListGroup>
  );
}
