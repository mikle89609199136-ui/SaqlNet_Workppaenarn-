import { Switch } from '@/components/ui';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

export function NotificationsSection() {
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection
      description="Настройте поведение уведомлений на этом устройстве."
      title="Уведомления и звуки"
    >
      <SettingsRow controlId="setting-notifications" label="Уведомления">
        <Switch
          checked={settings.notifications}
          id="setting-notifications"
          onChange={(event) => saveSettings({ notifications: event.target.checked })}
        />
      </SettingsRow>

      <SettingsRow controlId="setting-sounds" label="Звуки сообщений">
        <Switch
          checked={settings.sounds}
          id="setting-sounds"
          onChange={(event) => saveSettings({ sounds: event.target.checked })}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
