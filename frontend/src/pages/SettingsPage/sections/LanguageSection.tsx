import { Select } from '@/components/ui';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useTranslation } from 'react-i18next';
import { useSettingsData } from './useSettingsData';

/* Список из #162 — тот же, что предлагается при регистрации. Подписи на
   самих языках: человек, ищущий свой язык, скорее узнает «Türkçe», чем
   «турецкий», написанный на языке, которого он не знает.

   Переведён пока только английский, поэтому остальные закрыты для выбора:
   предложить язык и показать после этого русский интерфейс — хуже, чем
   честно сказать, что его ещё нет. Открывать по мере появления словарей
   в public/locales. */
const READY_LANGUAGES = ['ru', 'en'];

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
].map((option) => ({
  ...option,
  disabled: !READY_LANGUAGES.includes(option.value),
}));

export function LanguageSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection
      description={t('settings.language.description', 'Язык интерфейса CraneApp.')}
      title={t('settings.language.title', 'Язык')}
    >
      {/* Десять значений — здесь список: показать их все разом значило бы
          отдать под один выбор весь экран. */}
      <SettingsRow
        controlId="setting-language"
        label={t('settings.language.appLanguage', 'Язык приложения')}
      >
        <Select
          className="w-52"
          hint={t('settings.language.hint', 'Другие языки появятся, когда будут переведены')}
          id="setting-language"
          onChange={(value) => saveSettings({ language: value })}
          options={LANGUAGE_OPTIONS}
          value={settings.language}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
