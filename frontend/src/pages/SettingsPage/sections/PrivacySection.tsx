import type { TLastSeenVisibility } from '@/types';
import { ChoiceRow, SettingsSection, ToggleRow } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

const LAST_SEEN_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'contacts', label: 'Контакты' },
  { value: 'nobody', label: 'Никто' },
];

export function PrivacySection() {
  const { privacy, savePrivacy } = useSettingsData();

  return (
    <SettingsSection
      description="Управляйте тем, кто видит ваши данные."
      title="Конфиденциальность"
    >
      <ChoiceRow
        label="Последняя активность"
        onChange={(value: TLastSeenVisibility) => savePrivacy({ lastSeen: value })}
        options={LAST_SEEN_OPTIONS}
        value={privacy.lastSeen || 'all'}
      />
      {/* Умолчание — «разрешено»: отсутствие настройки не должно выглядеть
          как запрет, которого пользователь не ставил. */}
      <ToggleRow
        label="Сообщения от незнакомых"
        onChange={(value: boolean) => savePrivacy({ messagesFromStrangers: value })}
        value={privacy.messagesFromStrangers !== false}
      />
    </SettingsSection>
  );
}
