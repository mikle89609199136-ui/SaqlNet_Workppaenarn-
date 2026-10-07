import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatReceipt, isCoveredBy, receiptPatch, receiptState } from './receipts';

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

describe('состояние своего сообщения (#657)', () => {
  it('нет времени — отправлено, есть доставка — доставлено, есть прочтение — прочитано', () => {
    expect(receiptState({})).toBe('sent');
    expect(receiptState({ deliveredAt: '2026-09-29T10:00:00.000Z' })).toBe('delivered');
    expect(
      receiptState({ deliveredAt: '2026-09-29T10:00:00.000Z', readAt: '2026-09-29T10:01:00.000Z' })
    ).toBe('read');
  });

  it('прочитанное без отдельной доставки — всё равно прочитано', () => {
    expect(receiptState({ readAt: '2026-09-29T10:01:00.000Z' })).toBe('read');
  });
});

describe('граница события', () => {
  it('переходит сообщение ровно на границе, хотя у него есть микросекунды', () => {
    // Время сообщения — как его отдаёт сервер, граница — с отброшенными микросекундами.
    expect(isCoveredBy('2026-09-29 12:00:00.123956+00', '2026-09-29T12:00:00.123Z')).toBe(true);
  });

  it('не переходит более новое сообщение', () => {
    expect(isCoveredBy('2026-09-29 12:00:00.124+00', '2026-09-29T12:00:00.123Z')).toBe(false);
  });

  it('без времени сообщения — не переходит', () => {
    expect(isCoveredBy(undefined, '2026-09-29T12:00:00.123Z')).toBe(false);
    expect(isCoveredBy('', '2026-09-29T12:00:00.123Z')).toBe(false);
  });
});

describe('время из события', () => {
  const at = '2026-09-29T12:05:00.000Z';

  it('прочтение ставит и доставку', () => {
    expect(receiptPatch({}, 'read', at)).toEqual({ readAt: at, deliveredAt: at });
  });

  it('известное время не перезаписывается: оно первое', () => {
    const earlier = '2026-09-29T12:00:00.000Z';
    expect(receiptPatch({ deliveredAt: earlier }, 'read', at)).toEqual({ readAt: at });
    expect(receiptPatch({ deliveredAt: earlier }, 'delivered', at)).toBeNull();
    expect(receiptPatch({ deliveredAt: earlier, readAt: earlier }, 'read', at)).toBeNull();
  });

  it('запоздалая доставка после прочтения ничего не меняет', () => {
    expect(receiptPatch({ deliveredAt: at, readAt: at }, 'delivered', at)).toBeNull();
  });
});

describe('строка «Прочитано…» в меню', () => {
  // 29 сентября 2026, 15:00 по местному времени.
  const now = new Date(2026, 8, 29, 15, 0);
  const at = (day: number, hour: number, minute: number, year = 2026) =>
    new Date(year, 8, day, hour, minute).toISOString();

  it('сегодня, вчера, дата — по-русски', () => {
    expect(formatReceipt({ readAt: at(29, 9, 5) }, ru, { now, locale: 'ru' })).toBe(
      'Прочитано сегодня в 09:05'
    );
    expect(formatReceipt({ deliveredAt: at(28, 18, 40) }, ru, { now, locale: 'ru' })).toBe(
      'Доставлено вчера в 18:40'
    );
    expect(formatReceipt({ readAt: at(25, 12, 30) }, ru, { now, locale: 'ru' })).toBe(
      'Прочитано 25 сентября в 12:30'
    );
  });

  it('прошлый год — с годом', () => {
    expect(formatReceipt({ readAt: at(25, 12, 30, 2025) }, ru, { now, locale: 'ru' })).toBe(
      'Прочитано 25 сентября 2025 г. в 12:30'
    );
  });

  it('граница суток — по местному времени, а не по UTC', () => {
    const midnight = new Date(2026, 8, 29, 0, 1);
    expect(formatReceipt({ readAt: at(28, 23, 59) }, ru, { now: midnight, locale: 'ru' })).toBe(
      'Прочитано вчера в 23:59'
    );
    expect(formatReceipt({ readAt: at(29, 0, 0) }, ru, { now: midnight, locale: 'ru' })).toBe(
      'Прочитано сегодня в 00:00'
    );
  });

  it('прочтение важнее доставки', () => {
    expect(
      formatReceipt({ deliveredAt: at(29, 9, 0), readAt: at(29, 9, 5) }, ru, { now, locale: 'ru' })
    ).toBe('Прочитано сегодня в 09:05');
  });

  it('по-английски', () => {
    expect(formatReceipt({ readAt: at(29, 9, 5) }, en, { now, locale: 'en' })).toBe(
      'Read today at 09:05 AM'
    );
    expect(formatReceipt({ deliveredAt: at(28, 18, 40) }, en, { now, locale: 'en' })).toBe(
      'Delivered yesterday at 06:40 PM'
    );
  });

  it('отправлено или время не читается — строки нет', () => {
    expect(formatReceipt({}, ru, { now })).toBeNull();
    expect(formatReceipt({ readAt: 'мусор' }, ru, { now })).toBeNull();
  });
});
