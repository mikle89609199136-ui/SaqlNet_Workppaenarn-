import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import enTranslations from '../../../../public/locales/en/translation.json';
import ruTranslations from '../../../../public/locales/ru/translation.json';
import {
  isAccountSubsection,
  isPrivacySubsection,
  isSettingsSection,
} from '@/shared/config/routes';
import { SETTINGS_INDEX, searchSettings as searchIn } from '../model/settingsIndex';

// Настоящие словари: пункты находятся и подписываются на языке интерфейса.
let ru: TFunction;
let en: TFunction;
beforeAll(async () => {
  const instance = i18n.createInstance();
  await instance.init({
    lng: 'ru',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { ru: { translation: ruTranslations }, en: { translation: enTranslations } },
  });
  ru = instance.getFixedT('ru');
  en = instance.getFixedT('en');
});

const searchSettings = (query: string) => searchIn(query, ru);

/**
 * Поиск по настройкам.
 *
 * Проверяется на самом реестре, без отрисовки: важно, что находится и куда
 * ведёт, а не как выглядит список.
 */
describe('поиск по настройкам', () => {
  it('в английском интерфейсе находит по-английски и подписывает по-английски', () => {
    const found = searchIn('password', en);
    expect(found.map((entry) => entry.title)).toContain('Password');
    expect(found.find((entry) => entry.title === 'Password')).toMatchObject({
      section: 'Account',
      path: '/settings/account/password',
    });
    expect(searchIn('devices', en).map((entry) => entry.title)).toContain('Active sessions');
    // Набранное по-русски тоже находится — но показывается на языке интерфейса.
    expect(searchIn('пароль', en).map((entry) => entry.title)).toContain('Password');
  });

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
    // Человек ищет «устройства», а пункт называется «Активные сеансы».
    expect(searchSettings('устройства').map((entry) => entry.title)).toContain('Активные сеансы');
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
      const match = entry.path.match(/^\/settings\/([a-z]+)(?:\/([a-z-]+))?$/);
      expect(match, entry.path).not.toBeNull();
      const [, section, subsection] = match!;
      expect(isSettingsSection(section), entry.path).toBe(true);
      if (subsection) {
        // Подстраницы бывают только у аккаунта и конфиденциальности.
        const known =
          (section === 'account' && isAccountSubsection(subsection)) ||
          (section === 'privacy' && isPrivacySubsection(subsection));
        expect(known, entry.path).toBe(true);
      }
    }
  });
});
