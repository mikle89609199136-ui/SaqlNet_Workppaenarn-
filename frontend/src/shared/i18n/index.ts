import i18n from 'i18next';
import Backend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, detectLanguage, isSupportedLanguage } from './languages';

/**
 * Язык до того, как что-либо известно о человеке.
 *
 * Порядок такой: подтверждённый сервером выбор из проекции настроек,
 * затем язык браузера, затем русский. Проекция первой, иначе вошедший с
 * английским интерфейсом и немецким браузером каждый запуск видел бы
 * мигание: сперва определённый язык, потом сохранённый.
 *
 * Сама проекция читается тут же, а не хуком: язык нужен при создании
 * экземпляра, до первой отрисовки.
 */
function initialLanguage(): string {
  try {
    const raw = localStorage.getItem('craneapp_settings');
    const saved = raw && (JSON.parse(raw) as { language?: string }).language;
    if (isSupportedLanguage(saved)) return saved;
  } catch (_error) {
    /* приватный режим — определим по браузеру */
  }

  return detectLanguage();
}

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    lng: initialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    keySeparator: false,

    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: true,
    },
  });

/* Язык страницы — за языком интерфейса. В index.html стоит ru, и без этого
   экранный диктор читал английский интерфейс с русским произношением, а
   браузер предлагал «перевести с русского». */
const syncDocumentLanguage = (language: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
};
syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
