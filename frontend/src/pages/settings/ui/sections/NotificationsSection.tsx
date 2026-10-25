import { useTranslation } from 'react-i18next';
import { BrowserNotificationPermission, PushSettingItem } from '@/features/push-notifications';
import { formatVolume, setVoiceVolume, useVoiceVolume } from '@/shared/lib';
import { ListGroup, ListStaticItem, ListSwitchItem, Slider } from '@/shared/ui';
import { selectCallSounds } from '@/entities/user';
import { useSettingsData } from './useSettingsData';

/** «Уведомления и звуки» — переключатели уведомлений и звуков (макет #828, звонки #1002). */
export function NotificationsSection() {
  const { t } = useTranslation();
  const { settings, saveSettings, isSaving, isPending } = useSettingsData();
  const voiceVolume = useVoiceVolume();
  const voiceVolumeLabel = t('voice.volume', 'Громкость голосовых');

  return (
    <ListGroup>
      <ListSwitchItem
        disabled={isSaving || isPending}
        checked={settings.notifications}
        hint={t(
          'settings.notifications.masterHint',
          'Сообщения и звонки. Выключение сохраняет выбранные звуки и подписку устройства.'
        )}
        icon="bell"
        label={t('settings.notifications.enabled', 'Уведомления')}
        onChange={(checked) => saveSettings({ notifications: checked })}
      />
      {/* Push на этом устройстве, когда приложение закрыто (#882). */}
      <PushSettingItem />
      <BrowserNotificationPermission />
      <ListSwitchItem
        disabled={isSaving || isPending}
        checked={settings.sounds}
        hint={t('settings.notifications.soundsHint', 'Звук при входящем сообщении')}
        icon="volume"
        label={t('settings.notifications.sounds', 'Звуки сообщений')}
        onChange={(checked) => saveSettings({ sounds: checked })}
      />
      <ListSwitchItem
        disabled={isSaving || isPending}
        checked={selectCallSounds(settings)}
        hint={t(
          'settings.notifications.callSoundsHint',
          'Рингтон при входящем аудио- или видеозвонке'
        )}
        icon="phone"
        label={t('settings.notifications.callSounds', 'Звуки звонков')}
        onChange={(checked) => saveSettings({ callSounds: checked })}
      />
      <ListStaticItem
        hint={t('settings.notifications.voiceVolumeHint', 'Только на этом устройстве')}
        icon="mic"
        label={voiceVolumeLabel}
        trailing={
          <Slider
            aria-label={voiceVolumeLabel}
            caption={formatVolume(voiceVolume)}
            className="w-36 shrink-0"
            max={1}
            min={0}
            onChange={(event) => setVoiceVolume(Number(event.target.value))}
            step={0.05}
            value={voiceVolume}
            valueText={formatVolume(voiceVolume)}
          />
        }
      />
    </ListGroup>
  );
}
