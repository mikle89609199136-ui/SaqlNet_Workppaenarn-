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
