import { describe, expect, it } from 'vitest';
import { profileFormSchema } from './profileSchema';

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
