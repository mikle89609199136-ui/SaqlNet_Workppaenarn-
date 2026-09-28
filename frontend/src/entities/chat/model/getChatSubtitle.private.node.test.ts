import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { getChatSubtitle } from './getChatSubtitle';

const dictionary = (lang: string) =>
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../public/locales/${lang}/translation.json`),
      'utf-8'
    )
  ) as Record<string, string>;

// Настоящий словарь: проверяются и тексты, и формы множественного числа.
let ru: TFunction;
beforeAll(async () => {
  const instance = i18n.createInstance();
  await instance.init({
    lng: 'ru',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { ru: { translation: dictionary('ru') } },
  });
  ru = instance.getFixedT('ru');
});

// 26 сентября 2026, 15:00 по местному времени.
const now = new Date(2026, 8, 26, 15, 0);
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

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
    // Подпись «кто печатает» собирает useTypingLabel; здесь она только главнее.
    expect(getChatSubtitle(chat({ peerIsOnline: true }), 'печатает...', ru, now)).toBe(
      'печатает...'
    );
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
