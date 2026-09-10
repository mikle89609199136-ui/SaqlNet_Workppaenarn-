import { describe, expect, it } from 'vitest';
import { detectLanguage, isSupportedLanguage, LANGUAGES } from './languages';

/**
 * Определение языка по браузеру.
 *
 * Проверяется на списке предпочтений, а не на `navigator`: подменять
 * глобальный объект ради каждого случая — значит проверять подмену.
 */
describe('язык по умолчанию', () => {
  it('берёт первый знакомый из предпочтений человека', () => {
    // Порядок в navigator.languages и есть предпочтения: от желанного к
    // запасному. Немецкого у нас нет, английский есть.
    expect(detectLanguage(['de-DE', 'en-GB', 'ru'])).toBe('en');
  });

  it('не различает регион и письменность', () => {
    expect(detectLanguage(['ru-RU'])).toBe('ru');
    expect(detectLanguage(['EN-us'])).toBe('en');
  });

  it('на незнакомых языках оставляет русский', () => {
    expect(detectLanguage(['tr', 'fr-CA'])).toBe('ru');
  });

  it('обходится без предпочтений вовсе', () => {
    // Так бывает в тестовой среде и у части встроенных браузеров.
    expect(detectLanguage([])).toBe('ru');
  });

  it('знает только те языки, на которые интерфейс переведён', () => {
    expect(isSupportedLanguage('ru')).toBe(true);
    expect(isSupportedLanguage('en')).toBe(true);
    // Восемь языков из #162 убраны: словарей для них нет, а пункт в
    // списке читается как обещание.
    expect(isSupportedLanguage('de')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(LANGUAGES).toHaveLength(2);
  });
});
