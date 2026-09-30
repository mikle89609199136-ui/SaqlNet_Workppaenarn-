import { useTranslation } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  LANGUAGES,
  type TLanguage,
} from '@/shared/i18n/languages';
import { ListGroup, ListRadioItem } from '@/shared/ui';
import { useSettingsData } from './useSettingsData';

/* Список общий с регистрацией — держать два значило бы получить разные
   наборы в двух местах одного приложения.

   Подписи на самих языках: человек, ищущий свой язык, скорее узнает
   «English», чем «английский», написанный на языке, которого он не знает.
   Ниже — название на языке интерфейса, если оно другое (#828). */

const LOCAL_NAMES: Record<TLanguage, string> = { ru: 'Русский', en: 'Английский' };

export function LanguageSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();

  /* На сервере может лежать язык, которого в списке нет: раньше выбор был
     из десяти, а словарей — два. Отмечаем тот, на котором интерфейс на
     самом деле: незнакомое значение i18n всё равно сведёт к запасному. */
  const current = isSupportedLanguage(settings.language) ? settings.language : DEFAULT_LANGUAGE;

  return (
    <ListGroup radiogroup title={t('settings.language.appLanguage', 'Язык приложения')}>
      {LANGUAGES.map((language) => {
        const localName = t(
          `settings.language.names.${language.value}`,
          LOCAL_NAMES[language.value]
        );
        return (
          <ListRadioItem
            checked={current === language.value}
            hint={localName !== language.label ? localName : undefined}
            key={language.value}
            label={language.label}
            onSelect={() => saveSettings({ language: language.value })}
          />
        );
      })}
    </ListGroup>
  );
}
