import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';

const ruPath = resolve(import.meta.dirname, '../../../public/locales/ru/translation.json');
const enPath = resolve(import.meta.dirname, '../../../public/locales/en/translation.json');

const ruTranslations = JSON.parse(readFileSync(ruPath, 'utf-8')) as Record<string, string>;
const enTranslations = JSON.parse(readFileSync(enPath, 'utf-8')) as Record<string, string>;

describe('конфигурация i18n и поддержка плоских ключей с точкой', () => {
  it('словари ru и en имеют синхронный набор ключей', () => {
    const ruKeys = Object.keys(ruTranslations).sort();
    const enKeys = Object.keys(enTranslations).sort();

    expect(ruKeys).toEqual(enKeys);
    expect(ruKeys.length).toBeGreaterThan(200);
  });

  it('при keySeparator: false ключи с точками резолвятся как плоские строки', async () => {
    const testInstance = i18n.createInstance();
    await testInstance.init({
      lng: 'en',
      fallbackLng: 'ru',
      keySeparator: false,
      resources: {
        en: { translation: enTranslations },
        ru: { translation: ruTranslations },
      },
    });

    // Ключи из issue #638
    expect(testInstance.t('action.translate')).toBe('Translate');
    expect(testInstance.t('lastMessage.image')).toBe('Photo');
    expect(testInstance.t('lastMessage.audio')).toBe('Audio');
    expect(testInstance.t('lastMessage.video')).toBe('Video');
    expect(testInstance.t('lastMessage.file')).toBe('File');
    expect(testInstance.t('lastMessage.gif')).toBe('GIF');
    expect(testInstance.t('lastMessage.call')).toBe('Call');
    expect(testInstance.t('createChat.creationError')).toBe(
      'Could not create the group chat, something went wrong'
    );

    // Переключение на русский
    await testInstance.changeLanguage('ru');
    expect(testInstance.t('action.translate')).toBe('Перевести');
    expect(testInstance.t('lastMessage.image')).toBe('Фотография');
    expect(testInstance.t('lastMessage.audio')).toBe('Аудио');
    expect(testInstance.t('createChat.creationError')).toBe(
      'Не удалось создать групповой чат, что-то пошло не так'
    );
  });

  it('все ключи с точкой в словарях успешно переводятся на оба языка', async () => {
    const testInstance = i18n.createInstance();
    await testInstance.init({
      lng: 'en',
      fallbackLng: 'ru',
      keySeparator: false,
      resources: {
        en: { translation: enTranslations },
        ru: { translation: ruTranslations },
      },
    });

    const dottedKeys = Object.keys(enTranslations).filter((key) => key.includes('.'));
    expect(dottedKeys.length).toBeGreaterThan(100);

    for (const key of dottedKeys) {
      const enValue = testInstance.t(key);
      expect(enValue).toBe(enTranslations[key]);
      expect(enValue).not.toBe(key);
    }

    await testInstance.changeLanguage('ru');
    for (const key of dottedKeys) {
      const ruValue = testInstance.t(key);
      expect(ruValue).toBe(ruTranslations[key]);
      expect(ruValue).not.toBe(key);
    }
  });

  it('все ключи errors.* присутствуют и корректно переводятся', async () => {
    const testInstance = i18n.createInstance();
    await testInstance.init({
      lng: 'en',
      fallbackLng: 'ru',
      keySeparator: false,
      resources: {
        en: { translation: enTranslations },
        ru: { translation: ruTranslations },
      },
    });

    const expectedErrorKeys = [
      'errors.accessDenied',
      'errors.blockedByUser',
      'errors.chatNotFound',
      'errors.fileTooLarge',
      'errors.generic',
      'errors.invalid2fa',
      'errors.invalidCredentials',
      'errors.invalidFile',
      'errors.memberMuted',
      'errors.memberNotFound',
      'errors.notFound',
      'errors.rateLimited',
      'errors.unsupportedType',
      'errors.userNotFound',
      'errors.usernameTaken',
      'errors.validationFailed',
      'errors.weakPassword',
      'errors.wrongPassword',
    ];

    for (const key of expectedErrorKeys) {
      expect(enTranslations[key]).toBeDefined();
      expect(ruTranslations[key]).toBeDefined();
      expect(testInstance.t(key)).toBe(enTranslations[key]);
    }

    await testInstance.changeLanguage('ru');
    for (const key of expectedErrorKeys) {
      expect(testInstance.t(key)).toBe(ruTranslations[key]);
    }
  });

  it('ключи в обоих словарях отсортированы строго по алфавиту', () => {
    const ruKeys = Object.keys(ruTranslations);
    const enKeys = Object.keys(enTranslations);

    expect(ruKeys).toEqual([...ruKeys].sort());
    expect(enKeys).toEqual([...enKeys].sort());
  });
});
