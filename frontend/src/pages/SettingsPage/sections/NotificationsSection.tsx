import { Switch } from '@/components/ui';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useTranslation } from 'react-i18next';
import { useSettingsData } from './useSettingsData';

export function NotificationsSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection
      description={t(
        'settings.notifications.description',
        'Настройте поведение уведомлений на этом устройстве.'
      )}
      title={t('settings.notifications.title', 'Уведомления и звуки')}
    >
      <SettingsRow
        controlId="setting-notifications"
        label={t('settings.notifications.enabled', 'Уведомления')}
      >
        <Switch
          checked={settings.notifications}
          id="setting-notifications"
          onChange={(event) => saveSettings({ notifications: event.target.checked })}
        />
      </SettingsRow>

      <SettingsRow
        controlId="setting-sounds"
        label={t('settings.notifications.sounds', 'Звуки сообщений')}
      >
        <Switch
          checked={settings.sounds}
          id="setting-sounds"
          onChange={(event) => saveSettings({ sounds: event.target.checked })}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
