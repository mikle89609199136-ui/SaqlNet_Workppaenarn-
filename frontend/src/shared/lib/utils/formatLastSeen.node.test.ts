import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatLastSeen, formatLastSeenApprox } from './formatLastSeen';
import { getChatSubtitle } from './getChatSubtitle';

const dictionary = (lang: string) =>
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../public/locales/${lang}/translation.json`),
      'utf-8'
    )
  ) as Record<string, string>;

// Настоящие словари: проверяются и тексты, и формы множественного числа.
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

// 26 сентября 2026, 15:00 по местному времени.
const now = new Date(2026, 8, 26, 15, 0);
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const ruAt = (date: Date, at = now) => formatLastSeen(date, ru, { now: at, locale: 'ru' });
const enAt = (date: Date, at = now) => formatLastSeen(date, en, { now: at, locale: 'en' });

describe('«был(а)» — точное время относительно (#792)', () => {
  it('меньше минуты — «только что», в том числе при расхождении часов', () => {
    expect(ruAt(ago(0.5))).toBe('был(а) только что');
    expect(ruAt(new Date(now.getTime() + 10_000))).toBe('был(а) только что');
    expect(enAt(ago(0.5))).toBe('last seen just now');
  });

  it('меньше часа — минуты с правильной формой', () => {
    expect(ruAt(ago(1))).toBe('был(а) 1 минуту назад');
    expect(ruAt(ago(2))).toBe('был(а) 2 минуты назад');
    expect(ruAt(ago(5))).toBe('был(а) 5 минут назад');
    expect(ruAt(ago(11))).toBe('был(а) 11 минут назад');
    expect(ruAt(ago(21))).toBe('был(а) 21 минуту назад');
    expect(ruAt(ago(59))).toBe('был(а) 59 минут назад');
    expect(enAt(ago(1))).toBe('last seen 1 minute ago');
    expect(enAt(ago(5))).toBe('last seen 5 minutes ago');
  });

  it('сегодня — время, вчера — «вчера в»', () => {
    expect(ruAt(ago(60))).toBe('был(а) в 14:00');
    expect(ruAt(new Date(2026, 8, 26, 9, 5))).toBe('был(а) в 9:05');
    expect(ruAt(new Date(2026, 8, 25, 12, 30))).toBe('был(а) вчера в 12:30');
    expect(enAt(ago(60))).toBe('last seen at 2:00 PM');
    expect(enAt(new Date(2026, 8, 25, 12, 30))).toBe('last seen yesterday at 12:30 PM');
  });

  it('раньше — дата, в прошлом году — с годом', () => {
    expect(ruAt(new Date(2026, 8, 20, 12, 30))).toBe('был(а) 20 сентября в 12:30');
    expect(ruAt(new Date(2025, 8, 25, 12, 30))).toBe('был(а) 25 сентября 2025 г. в 12:30');
    expect(enAt(new Date(2026, 8, 20, 12, 30))).toBe('last seen September 20 at 12:30 PM');
    expect(enAt(new Date(2025, 8, 25, 12, 30))).toBe('last seen September 25, 2025 at 12:30 PM');
  });

  it('около полуночи: сначала минуты, потом «вчера»', () => {
    const lateEvening = new Date(2026, 8, 25, 23, 50);
    expect(ruAt(lateEvening, new Date(2026, 8, 26, 0, 30))).toBe('был(а) 40 минут назад');
    expect(ruAt(lateEvening, new Date(2026, 8, 26, 1, 30))).toBe('был(а) вчера в 23:50');
  });

  it('нечитаемое время — «недавно»', () => {
    expect(formatLastSeen('not a date', ru, { now, locale: 'ru' })).toBe('был(а) недавно');
  });

  it('разбирает дату в формате Postgres (с пробелом вместо T)', () => {
    const postgresDate = '2026-09-26 14:55:00.123456+00';
    const at = new Date('2026-09-26T15:00:01Z');
    expect(formatLastSeen(postgresDate, ru, { now: at, locale: 'ru' })).toBe('был(а) 5 минут назад');
  });
});

describe('«был(а)» — приблизительное время вместо скрытого (#791)', () => {
  it('все промежутки на обоих языках', () => {
    expect(formatLastSeenApprox('recently', ru)).toBe('был(а) недавно');
    expect(formatLastSeenApprox('within_week', ru)).toBe('был(а) на этой неделе');
    expect(formatLastSeenApprox('within_month', ru)).toBe('был(а) в этом месяце');
    expect(formatLastSeenApprox('long_ago', ru)).toBe('был(а) давно');
    expect(formatLastSeenApprox('within_week', en)).toBe('last seen within a week');
    expect(formatLastSeenApprox('long_ago', en)).toBe('last seen a long time ago');
  });
});

describe('подзаголовок личного чата', () => {
  const chat = (extra: object) => ({ type: 'private', ...extra });

  it('«в сети» и «печатает» важнее времени', () => {
    expect(
      getChatSubtitle(
        chat({ peerIsOnline: true, peerLastSeen: ago(5).toISOString() }),
        null,
        ru,
        now
      )
    ).toBe('онлайн');
    expect(getChatSubtitle(chat({ peerIsOnline: true }), 'someone', ru, now)).toBe('печатает...');
  });

  it('точное время, промежуток, а без обоих — «давно»', () => {
    expect(getChatSubtitle(chat({ peerLastSeen: ago(5).toISOString() }), null, ru, now)).toBe(
      'был(а) 5 минут назад'
    );
    expect(getChatSubtitle(chat({ peerLastSeenApprox: 'within_month' }), null, ru, now)).toBe(
      'был(а) в этом месяце'
    );
    // Время видно, но человек ни разу не был в сети.
    expect(getChatSubtitle(chat({}), null, ru, now)).toBe('был(а) давно');
  });

  it('строка пересчитывается от переданного времени', () => {
    const lastSeen = ago(5).toISOString();
    expect(getChatSubtitle(chat({ peerLastSeen: lastSeen }), null, ru, now)).toBe(
      'был(а) 5 минут назад'
    );
    expect(
      getChatSubtitle(
        chat({ peerLastSeen: lastSeen }),
        null,
        ru,
        new Date(now.getTime() + 10 * 60_000)
      )
    ).toBe('был(а) 15 минут назад');
  });
});
