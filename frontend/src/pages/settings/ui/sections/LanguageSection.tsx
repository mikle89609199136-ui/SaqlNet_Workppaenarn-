import { Select } from '@/shared/ui';
import { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGES } from '@/shared/i18n/languages';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useTranslation } from 'react-i18next';
import { useSettingsData } from './useSettingsData';

/* Список общий с регистрацией — держать два значило бы получить разные
   наборы в двух местах одного приложения.

   Подписи на самих языках: человек, ищущий свой язык, скорее узнает
   «English», чем «английский», написанный на языке, которого он не знает. */

export function LanguageSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();

  return (
    <SettingsSection
      description={t('settings.language.description', 'Язык интерфейса CraneApp.')}
      title={t('settings.language.title', 'Язык')}
    >
      <SettingsRow
        controlId="setting-language"
        label={t('settings.language.appLanguage', 'Язык приложения')}
      >
        <Select
          className="w-52"
          id="setting-language"
          onChange={(value) => saveSettings({ language: value })}
          options={[...LANGUAGES]}
          /* На сервере может лежать язык, которого в списке нет: раньше
             выбор был из десяти, а словарей — два. Показываем тот, на
             котором интерфейс на самом деле: незнакомое значение i18n
             всё равно сведёт к запасному. */
          value={isSupportedLanguage(settings.language) ? settings.language : DEFAULT_LANGUAGE}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
