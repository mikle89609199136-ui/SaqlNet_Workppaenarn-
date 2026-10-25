import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatEditedAt } from './messageUtils';

const dictionary = (lang: string) =>
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../public/locales/${lang}/translation.json`),
      'utf-8'
    )
  ) as Record<string, string>;

// Настоящие словари: проверяются и сами тексты.
let ru: TFunction;
let en: TFunction;
beforeAll(async () => {
  const instance = i18n.createInstance();
  await instance.init({
    lng: 'ru',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { ru: { translation: dictionary('ru') }, en: { translation: dictionary('en') } },
  });
  ru = instance.getFixedT('ru');
  en = instance.getFixedT('en');
});

/* Время правки (#1066): по наведению на «изменено» и строкой в меню. */
describe('строка «Изменено…»', () => {
  // 17 октября 2026, 21:30 по местному времени.
  const now = new Date(2026, 9, 17, 21, 30);
  const edited = (updatedAt: Date | string) => ({ isEdited: true, updatedAt: updatedAt as Date });

  it('неизменённое — без строки', () => {
    expect(formatEditedAt({ isEdited: false, updatedAt: now }, ru, { now })).toBeNull();
  });

  it('сегодня, вчера и дата этого года — по-русски', () => {
    expect(formatEditedAt(edited(new Date(2026, 9, 17, 21, 5)), ru, { now, locale: 'ru' })).toBe(
      'Изменено сегодня в 21:05'
    );
    expect(formatEditedAt(edited(new Date(2026, 9, 16, 18, 40)), ru, { now, locale: 'ru' })).toBe(
      'Изменено вчера в 18:40'
    );
    expect(formatEditedAt(edited(new Date(2026, 8, 25, 12, 30)), ru, { now, locale: 'ru' })).toBe(
      'Изменено 25 сентября в 12:30'
    );
  });

  it('прошлый год — с годом', () => {
    expect(formatEditedAt(edited(new Date(2025, 8, 25, 12, 30)), ru, { now, locale: 'ru' })).toBe(
      'Изменено 25 сентября 2025 г. в 12:30'
    );
  });

  it('граница суток — по местному времени', () => {
    const justAfterMidnight = new Date(2026, 9, 17, 0, 1);
    const justBeforeMidnight = new Date(2026, 9, 16, 23, 59);

    expect(formatEditedAt(edited(justAfterMidnight), ru, { now, locale: 'ru' })).toMatch(
      /^Изменено сегодня/
    );
    expect(formatEditedAt(edited(justBeforeMidnight), ru, { now, locale: 'ru' })).toMatch(
      /^Изменено вчера/
    );
  });

  it('по-английски', () => {
    expect(formatEditedAt(edited(new Date(2026, 9, 17, 9, 5)), en, { now, locale: 'en-GB' })).toBe(
      'Edited today at 09:05'
    );
  });

  it('время строкой в формате сервера разбирается', () => {
    const got = formatEditedAt(edited('2026-10-17 12:34:56.123456+00'), ru, { now, locale: 'ru' });

    expect(got).toMatch(/^Изменено (сегодня|вчера) в \d\d:\d\d$/);
  });

  it('неразборчивое время — без строки', () => {
    expect(formatEditedAt(edited('not a date'), ru, { now })).toBeNull();
  });
});
