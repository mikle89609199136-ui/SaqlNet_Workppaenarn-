import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * Синхронный i18n для тестов.
 *
 * Рабочая конфигурация тянет переводы по HTTP и включает Suspense — в тестах
 * это означало бы ожидание загрузки и обёртку Suspense в каждом дереве.
 *
 * Ресурсы намеренно пустые: приложение везде передаёт запасное значение
 * вторым аргументом — `t('close', 'Закрыть')`, — и именно оно попадёт в DOM.
 * Значит тесты ищут по тому же тексту, что видит пользователь, и не сломаются,
 * когда переводы появятся.
 */
const testI18n = i18n.createInstance();

testI18n.use(initReactI18next).init({
  lng: 'ru',
  fallbackLng: 'ru',
  keySeparator: false,
  resources: { ru: { translation: {} } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { testI18n };
