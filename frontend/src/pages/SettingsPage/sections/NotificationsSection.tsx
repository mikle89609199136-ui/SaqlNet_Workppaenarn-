import { SettingsSection, ToggleRow } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

export function NotificationsSection() {
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection
      description="Настройте поведение уведомлений на этом устройстве."
      title="Уведомления и звуки"
    >
      <ToggleRow
        label="Уведомления"
        onChange={(value: boolean) => saveSettings({ notifications: value })}
        value={settings.notifications}
      />
      <ToggleRow
        label="Звуки сообщений"
        onChange={(value: boolean) => saveSettings({ sounds: value })}
        value={settings.sounds}
      />
    </SettingsSection>
  );
}
