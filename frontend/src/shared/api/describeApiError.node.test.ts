import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeApiError } from './describeApiError';

const ruPath = resolve(import.meta.dirname, '../../../public/locales/ru/translation.json');
const ruTranslations = JSON.parse(readFileSync(ruPath, 'utf-8')) as Record<string, string>;

/** Переводчик тестов: отдаёт строку из словаря или запасной текст */
const t = ((key: string, fallback?: string) => ruTranslations[key] ?? fallback ?? key) as never;

describe('объяснение ошибки сервера', () => {
  it('переводит известный код через ключ словаря', () => {
    const результат = describeApiError({ code: 'member_muted', message: 'member is muted' }, t);

    expect(результат).toBe('В этом чате вам запрещено писать');
  });

  it('переводит код invalid_2fa', () => {
    const результат = describeApiError({ code: 'invalid_2fa', message: 'invalid 2fa code' }, t);

    expect(результат).toBe('Неверный код');
  });

  it('переводит код username_change_cooldown', () => {
    const результат = describeApiError(
      {
        code: 'username_change_cooldown',
        message: 'username can only be changed once every 24 hours',
      },
      t
    );

    expect(результат).toBe('Имя пользователя можно менять не чаще одного раза в 24 часа');
  });

  it('никогда не показывает английский текст сервера', () => {
    /* Ради этого всё и затевалось: `message` написан для разработчика. */
    const результат = describeApiError(
      { code: 'some_new_code', message: 'something went terribly wrong' },
      t
    );

    expect(результат).not.toContain('terribly');
    expect(результат).toBe('Не получилось. Попробуйте ещё раз');
  });

  it('берёт запасной текст места вызова, когда код незнаком', () => {
    const результат = describeApiError(
      { code: 'unknown_code' },
      t,
      'Не удалось закрепить сообщение'
    );

    expect(результат).toBe('Не удалось закрепить сообщение');
  });

  it('без кода и без запасного текста отвечает общей фразой', () => {
    expect(describeApiError({ message: 'boom' }, t)).toBe('Не получилось. Попробуйте ещё раз');
  });

  it('переживает отсутствие ошибки', () => {
    expect(describeApiError(null, t)).toBe('Не получилось. Попробуйте ещё раз');
    expect(describeApiError(undefined, t)).toBe('Не получилось. Попробуйте ещё раз');
  });

  it('сообщает в консоль о коде без перевода', () => {
    /* Иначе новые коды копятся молча, и никто не узнает, что человеку
       показывают общую фразу вместо объяснения. */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    describeApiError({ code: 'brand_new_code', message: 'nope' }, t);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('brand_new_code'));
    warn.mockRestore();
  });
});
