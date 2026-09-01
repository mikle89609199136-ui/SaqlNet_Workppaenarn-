import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX, searchSettings } from '../settingsIndex';

/**
 * Поиск по настройкам.
 *
 * Проверяется на самом реестре, без отрисовки: важно, что находится и куда
 * ведёт, а не как выглядит список.
 */
describe('поиск по настройкам', () => {
  it('находит то, что лежит на подстранице и в меню не видно', () => {
    const found = searchSettings('пароль');

    // Ради этого поиск и заведён: «Пароль» — не раздел, до него два шага.
    expect(found.map((entry) => entry.title)).toContain('Пароль');
    expect(found.find((entry) => entry.title === 'Пароль')?.path).toBe(
      '/settings/account/password'
    );
  });

  it('ищет по части слова', () => {
    expect(searchSettings('пар').map((entry) => entry.title)).toContain('Пароль');
  });

  it('не различает «е» и «ё»', () => {
    // Пункт называется «Тема оформления», в синонимах — «тёмная».
    expect(searchSettings('темная').map((entry) => entry.title)).toContain('Тема оформления');
  });

  it('находит по слову, которого нет в названии', () => {
    // Человек ищет «2FA», а пункт называется «Двухфакторная аутентификация».
    expect(searchSettings('2fa').map((entry) => entry.title)).toContain(
      'Двухфакторная аутентификация'
    );
  });

  it('находит по названию раздела', () => {
    expect(searchSettings('конфиденциальность').length).toBeGreaterThan(0);
  });

  it('на пустой запрос не показывает ничего', () => {
    // Пустая строка — это не «показать всё»: список висел бы поверх экрана
    // всё время.
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });

  it('ничего не находит по бессмыслице', () => {
    expect(searchSettings('щщщ')).toEqual([]);
  });

  it('каждый пункт ведёт по настоящему адресу настроек', () => {
    for (const entry of SETTINGS_INDEX) {
      expect(entry.path).toMatch(/^\/settings\/[a-zA-Z/]+$/);
    }
  });
});
