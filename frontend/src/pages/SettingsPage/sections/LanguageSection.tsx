import { Select } from '@/components/ui';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

/* Список из #162 — тот же, что предлагается при регистрации. Подписи на
   самих языках: человек, ищущий свой язык, скорее узнает «Türkçe», чем
   «турецкий», написанный на языке, которого он не знает. */
const LANGUAGE_OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'pl', label: 'Polski' },
  { value: 'uk', label: 'Українська' },
  { value: 'tr', label: 'Türkçe' },
];

export function LanguageSection() {
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection description="Язык интерфейса CraneApp." title="Язык">
      {/* Десять значений — здесь список: показать их все разом значило бы
          отдать под один выбор весь экран. */}
      <SettingsRow controlId="setting-language" label="Язык приложения">
        <Select
          className="w-52"
          id="setting-language"
          onChange={(value) => saveSettings({ language: value })}
          options={LANGUAGE_OPTIONS}
          value={settings.language}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
