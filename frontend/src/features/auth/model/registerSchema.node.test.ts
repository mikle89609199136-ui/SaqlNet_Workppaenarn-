import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { createRegisterFormSchema } from './registerSchema';

// Подсчёт кодовых точек совпадает с PostgreSQL и API.
describe('длина имени при регистрации', () => {
  const instance = i18n.createInstance();
  const data = {
    firstName: 'Имя',
    lastName: '',
    username: 'valid_user',
    bio: '',
    password: 'parolproba1!',
    passwordRepeat: 'parolproba1!',
  };
  const schema = createRegisterFormSchema(instance.t);
  for (const field of ['firstName', 'lastName']) {
    for (const symbol of ['a', 'Я', '😀', 'e\u0301']) {
      it(`${field}, ${symbol}: граница 64/65`, () => {
        const value = symbol.repeat(symbol === 'e\u0301' ? 32 : 64);
        expect(schema.safeParse({ ...data, [field]: value }).success).toBe(true);
        expect(schema.safeParse({ ...data, [field]: value + 'a' }).success).toBe(false);
      });
    }
  }
  it('пустая фамилия допустима, пустое имя запрещено', () => {
    expect(schema.safeParse(data).success).toBe(true);
    expect(schema.safeParse({ ...data, firstName: '  ' }).success).toBe(false);
  });
});
