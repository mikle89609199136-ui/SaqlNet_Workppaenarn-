import { ChoiceRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

/* Словарей в проекте пока нет: public/locales/ru/translation.json пуст,
   английского файла нет вовсе. Выбор сохраняется и меняет язык i18n, но
   надписи берутся из запасных значений t('ключ', 'Русский текст'), и
   поэтому не меняются. */
const LANGUAGE_OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

export function LanguageSection() {
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection description="Язык интерфейса CraneApp." title="Язык">
      <ChoiceRow
        label="Язык приложения"
        onChange={(value: string) => saveSettings({ language: value })}
        options={LANGUAGE_OPTIONS}
        value={settings.language}
      />
    </SettingsSection>
  );
}
