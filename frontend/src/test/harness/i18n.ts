import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ruTranslations from '../../../public/locales/ru/translation.json';

/**
 * Синхронный i18n для тестов.
 *
 * Рабочая конфигурация тянет переводы по HTTP и включает Suspense — в тестах
 * это означало бы ожидание загрузки и обёртку Suspense в каждом дереве.
 *
 * Ресурсы содержат только ошибки API (errors.*), у которых нет запасных строк
 * по месту вызова в компонентах. Остальные тексты берутся из второго аргумента
 * t('key', 'запасной текст'), как и задумано в тестах компонентов.
 */
const errorTranslations: Record<string, string> = Object.fromEntries(
  Object.entries(ruTranslations).filter(([k]) => k.startsWith('errors.'))
);

const testI18n = i18n.createInstance();

testI18n.use(initReactI18next).init({
  lng: 'ru',
  fallbackLng: 'ru',
  keySeparator: false,
  resources: { ru: { translation: errorTranslations } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { testI18n };
