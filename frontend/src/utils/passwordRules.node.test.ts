import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  getPasswordScore,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
  passwordSchema,
} from './passwordRules';

/**
 * Требования к паролю.
 *
 * Проверяется соответствие серверной политике
 * (`backend-v2/internal/auth/password_validator.go`): именно из-за
 * расхождения форма пропускала пароль, который сервер отвергал.
 * Проверки идут на самих правилах, без отрисовки формы.
 */
describe('требования к паролю', () => {
  it('повторяет пороги сервера', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(MAX_PASSWORD_LENGTH).toBe(64);
  });

  it('принимает пароль, отвечающий политике', () => {
    expect(passwordSchema.safeParse('Parol12345!').success).toBe(true);
    // Заглавная сервером не требуется — не требуем и мы, иначе не дали бы
    // ввести пароль, который сервер бы принял.
    expect(passwordSchema.safeParse('parol12345!').success).toBe(true);
  });

  it.each([
    ['Parol123!', 'девять символов — короче десяти'],
    ['ParolParol!', 'без цифры'],
    ['Parol123456', 'без знака'],
    ['Parol 12345!', 'с пробелом внутри'],
    ['Parol\t12345!', 'с табуляцией'],
  ])('не принимает «%s» — %s', (password) => {
    expect(passwordSchema.safeParse(password).success).toBe(false);
  });

  it('не принимает длиннее шестидесяти четырёх', () => {
    const long = `${'a1!'.repeat(22)}xyz`;
    expect([...long].length).toBeGreaterThan(MAX_PASSWORD_LENGTH);
    expect(passwordSchema.safeParse(long).success).toBe(false);
  });

  it('называет ближайшее невыполненное требование', () => {
    const result = passwordSchema.safeParse('parol');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Не менее 10 символов');
    }
  });

  it('знаком считает только то, что считает сервер', () => {
    // Список в password_validator.go: "!@#$%^&*()_+-=[]{}|;:'\",.<>/?`~"
    expect(checkPassword('parol12345!').special).toBe(true);
    expect(checkPassword('parol12345_').special).toBe(true);
    // «№» и длинное тире в серверный список не входят: засчитай мы их —
    // форма пропустила бы пароль, который сервер отвергнет.
    expect(checkPassword('parol12345№').special).toBe(false);
    expect(checkPassword('parol12345—').special).toBe(false);
  });

  it('считает длину в символах, а не в байтах', () => {
    // Сервер меряет рунами (utf8.RuneCountInString). Десять кириллических
    // букв — это десять символов, хотя байтов вдвое больше.
    expect(checkPassword('пароль1234').length).toBe(true);
    expect(checkPassword('пароль123').length).toBe(false);
  });

  it('оценка силы совпадает с числом требований', () => {
    // Полоска под полем меряется этим же: разойдись они, полоска
    // доходила бы до конца у пароля, который форма не принимает.
    expect(getPasswordScore('parol12345!')).toBe(PASSWORD_RULES.length);
    expect(getPasswordScore('')).toBe(0);
    expect(getPasswordScore('parol')).toBe(0);
  });

  it('в подсказках нет запретов', () => {
    // Список под полем говорит, что сделать. «Не длиннее 64» и «без
    // пробелов» выполнены по умолчанию, и в списке были бы двумя
    // зелёными галочками ни о чём — их проверяет схема.
    expect(PASSWORD_RULES.map((rule) => rule.id)).toEqual(['length', 'digit', 'special']);
  });
});
