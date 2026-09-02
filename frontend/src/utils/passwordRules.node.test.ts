import { describe, expect, it } from 'vitest';
import { checkPassword, getPasswordScore, PASSWORD_RULES, passwordSchema } from './passwordRules';

/**
 * Требования к паролю.
 *
 * Проверяются на самих правилах, без отрисовки формы: важно, что
 * считается годным паролем, а не как это выглядит.
 */
describe('требования к паролю', () => {
  it('принимает пароль, отвечающий всем требованиям', () => {
    expect(passwordSchema.safeParse('Parol123!').success).toBe(true);
  });

  it.each([
    ['Ab1!', 'слишком короткий'],
    ['parol123!', 'без заглавной'],
    ['ParolParol!', 'без цифры'],
    ['Parol12345', 'без знака'],
  ])('не принимает «%s» — %s', (password) => {
    expect(passwordSchema.safeParse(password).success).toBe(false);
  });

  it('называет ближайшее невыполненное требование', () => {
    const result = passwordSchema.safeParse('parol123!');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Заглавная буква');
    }
  });

  it('засчитывает заглавную не только в латинице', () => {
    // Человек набирает пароль по-русски — заглавная там такая же заглавная.
    expect(checkPassword('Пароль123!').uppercase).toBe(true);
  });

  it('засчитывает знаки с любой раскладки', () => {
    // «№» и «—» набираются в русской раскладке; списком их легко забыть.
    expect(checkPassword('Parol123№').symbol).toBe(true);
    expect(checkPassword('Parol123—').symbol).toBe(true);
  });

  it('не считает пробел знаком', () => {
    // Иначе «Parol 123» проходил бы как пароль со специальным знаком.
    expect(checkPassword('Parol 123').symbol).toBe(false);
  });

  it('оценка силы совпадает с числом требований', () => {
    // Полоска под полем меряется этим же: разойдись они, полоска
    // доходила бы до конца у пароля, который форма не принимает.
    expect(getPasswordScore('Parol123!')).toBe(PASSWORD_RULES.length);
    expect(getPasswordScore('')).toBe(0);
    expect(getPasswordScore('parol')).toBe(0);
  });
});
