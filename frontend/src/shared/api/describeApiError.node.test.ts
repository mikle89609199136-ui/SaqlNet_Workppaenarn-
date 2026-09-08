import { describe, expect, it, vi } from 'vitest';
import { describeApiError } from './describeApiError';

/** Переводчик тестов: отдаёт запасной текст, как настоящий при пустом словаре. */
const t = ((_key: string, fallback: string) => fallback) as never;

describe('объяснение ошибки сервера', () => {
  it('переводит известный код', () => {
    const результат = describeApiError({ code: 'member_muted', message: 'member is muted' }, t);

    expect(результат).toBe('В этом чате вам запрещено писать');
  });

  it('никогда не показывает английский текст сервера', () => {
    /* Ради этого всё и затевалось: `message` написан для разработчика. */
    const результат = describeApiError(
      { code: 'some_new_code', message: 'something went terribly wrong' },
      t
    );

    expect(результат).not.toContain('terribly');
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
