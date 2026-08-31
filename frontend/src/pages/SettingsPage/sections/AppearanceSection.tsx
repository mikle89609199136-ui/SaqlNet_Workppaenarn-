import type { ISettingsDto } from '@/types';
import { ChoiceRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

/* Вариантов два, и оба задаются атрибутом data-theme. Режима «как в
   системе» нет — см. шапку styles/tokens/themes.css. */
const THEME_OPTIONS = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
];

export function AppearanceSection() {
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection description="Выберите тему интерфейса." title="Внешний вид">
      <ChoiceRow
        label="Тема"
        onChange={(value: ISettingsDto['theme']) => saveSettings({ theme: value })}
        options={THEME_OPTIONS}
        value={settings.theme}
      />
    </SettingsSection>
  );
}
