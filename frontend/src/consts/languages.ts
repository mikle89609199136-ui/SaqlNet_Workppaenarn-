/**
 * Языки интерфейса.
 *
 * Список — это то, на что переведён интерфейс, а не то, что мы хотели бы
 * поддержать. Раньше в настройках висело десять пунктов, из них восемь
 * недоступных: человек читал их как обещание, а получал заглушки. Язык
 * добавляется сюда вместе со словарём в `public/locales`, не раньше.
 */
export const LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
] as const;

export type TLanguage = (typeof LANGUAGES)[number]['value'];

export const DEFAULT_LANGUAGE: TLanguage = 'ru';

export function isSupportedLanguage(value: string | undefined | null): value is TLanguage {
  return LANGUAGES.some((language) => language.value === value);
}

/**
 * Язык, на котором показать интерфейс тому, о ком мы ничего не знаем.
 *
 * Берётся из браузера: человек, открывший приложение впервые, не должен
 * первым делом искать переключатель. Список `navigator.languages`
 * перебирается по порядку — он и есть предпочтения человека, от самого
 * желанного к запасному.
 *
 * Región и письменность отбрасываются: `en-GB`, `ru-RU` и `en` для нас
 * один и тот же словарь. Ничего знакомого не нашлось — остаётся русский.
 */
export function detectLanguage(
  languages: readonly string[] = globalThis.navigator?.languages ?? []
): TLanguage {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isSupportedLanguage(base)) return base;
  }

  return DEFAULT_LANGUAGE;
}
