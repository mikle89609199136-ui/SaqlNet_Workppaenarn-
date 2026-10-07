/**
 * Версия приложения.
 *
 * Значение подставляет сборщик из package.json (см. `define` в
 * vite.config.ts). Проверка через `typeof` не случайна: вне сборки —
 * в тестах, в скриптах — константы не существует, а `typeof` на
 * необъявленном имени безопасен, тогда как обращение к нему бросает
 * ReferenceError.
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * Номер сборки (#892): время сборки, то же, что в `/version.json`. Разные
 * номера — на сервере другая сборка, даже если версия та же.
 */
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** Когда собрано (ISO 8601); вне сборки — null. Показывается в «О приложении». */
export const APP_BUILT_AT = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : null;
