import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import ruTranslations from '../../../../public/locales/ru/translation.json';
import { createProfileFormSchema } from './profileSchema';

// Схема с настоящим русским словарём: проверяются и правила, и тексты.
let profileFormSchema: ReturnType<typeof createProfileFormSchema>;
beforeAll(async () => {
  const instance = i18n.createInstance();
  await instance.init({
    lng: 'ru',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { ru: { translation: ruTranslations } },
  });
  profileFormSchema = createProfileFormSchema(instance.t);
});

describe('profileFormSchema', () => {
  const validData = {
    firstName: 'Иван',
    lastName: 'Иванов',
    username: 'ivan_123',
    bio: 'О себе',
  };

  it('валидирует корректные данные формы', () => {
    const result = profileFormSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  describe('username', () => {
    it('принимает латинские буквы, цифры и знак подчёркивания', () => {
      const result = profileFormSchema.safeParse({ ...validData, username: 'user_99' });
      expect(result.success).toBe(true);
    });

    it('отклоняет имя короче 3 символов', () => {
      const result = profileFormSchema.safeParse({ ...validData, username: 'ab' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Не менее 3 символов');
      }
    });

    it('отклоняет имя длиннее 32 символов', () => {
      const result = profileFormSchema.safeParse({
        ...validData,
        username: 'a'.repeat(33),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Не более 32 символов');
      }
    });

    it('отклоняет недопустимые символы (дефис, пробелы, кириллицу)', () => {
      expect(profileFormSchema.safeParse({ ...validData, username: 'user-name' }).success).toBe(
        false
      );
      expect(profileFormSchema.safeParse({ ...validData, username: 'user name' }).success).toBe(
        false
      );
      expect(profileFormSchema.safeParse({ ...validData, username: 'иван_123' }).success).toBe(
        false
      );
    });
  });
});

describe('длина имён в кодовых точках Unicode', () => {
  for (const field of ['firstName', 'lastName']) {
    for (const symbol of ['a', 'Я', '😀', 'e\u0301']) {
      it(`${field}, ${symbol}: граница 64/65`, () => {
        const value = symbol.repeat(symbol === 'e\u0301' ? 32 : 64);
        const data = { firstName: 'Имя', lastName: '', username: 'valid_user', bio: '' };
        expect(profileFormSchema.safeParse({ ...data, [field]: value }).success).toBe(true);
        expect(profileFormSchema.safeParse({ ...data, [field]: value + 'a' }).success).toBe(false);
      });
    }
  }
  it('пустая фамилия допустима, пустое имя запрещено', () => {
    const data = { firstName: 'Имя', lastName: '', username: 'valid_user', bio: '' };
    expect(profileFormSchema.safeParse(data).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...data, firstName: '  ' }).success).toBe(false);
  });
});
