import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import enTranslations from '../../../../public/locales/en/translation.json';
import ruTranslations from '../../../../public/locales/ru/translation.json';
import {
  checkPassword,
  createPasswordSchema,
  getPasswordScore,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
} from './passwordRules';

// Настоящие словари: тексты правил и ошибок проверяются на обоих языках.
let ru: TFunction;
let en: TFunction;
let passwordSchema: ReturnType<typeof createPasswordSchema>;
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
  passwordSchema = createPasswordSchema(ru);
});

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

  it('правила и ошибки — на языке интерфейса, с числами из политики', () => {
    expect(PASSWORD_RULES.map((rule) => rule.label(ru))).toEqual([
      'Не менее 10 символов',
      'Цифра',
      'Знак из !@#$%^&* и подобных',
    ]);
    expect(PASSWORD_RULES.map((rule) => rule.label(en))).toEqual([
      'At least 10 characters',
      'A digit',
      'A symbol such as !@#$%^&*',
    ]);

    const issues = (t: TFunction, value: string) => {
      const result = createPasswordSchema(t).safeParse(value);
      return result.success ? null : result.error.issues[0].message;
    };
    expect(issues(en, 'parol')).toBe('At least 10 characters');
    expect(issues(en, `${'a1!'.repeat(22)}xyz`)).toBe('At most 64 characters');
    expect(issues(en, 'parol 12345!')).toBe('No spaces');
    expect(issues(en, 'parolparol!')).toBe('Add a digit');
    expect(issues(en, 'parol123456')).toBe('Add a symbol: ! @ # $ % or similar');
  });

  it('в подсказках нет запретов', () => {
    // Список под полем говорит, что сделать. «Не длиннее 64» и «без
    // пробелов» выполнены по умолчанию, и в списке были бы двумя
    // зелёными галочками ни о чём — их проверяет схема.
    expect(PASSWORD_RULES.map((rule) => rule.id)).toEqual(['length', 'digit', 'special']);
  });
});

/**
 * Подсказка в поле пароля.
 *
 * Её текст живёт в переводах, а число — в правиле, и связь между ними
 * ничем не держалась: подсказка обещала шесть символов, тогда как список
 * требований, полоска и схема требовали десяти (#691). Расхождение
 * пережило даже перевод на английский — там стояло «At least 6 characters».
 *
 * Поэтому проверяется не текст, а то, что числа в нём нет вовсе: оно
 * подставляется из MIN_PASSWORD_LENGTH. Вписанное руками снова разойдётся
 * при первой же правке политики, и заметить это будет нечем.
 */
describe('подсказка в поле пароля', () => {
  it.each([
    ['русский', 'ru', ruTranslations],
    ['английский', 'en', enTranslations],
  ])('%s: число подставляется из правила', async (_language, language, translations) => {
    const hint = (translations as Record<string, string>).passwordMin;

    expect(hint).not.toMatch(/\d/);

    // И число действительно подставляется — тем же способом, что в форме.
    // Без этого проверка шаблона прошла бы и на «{{min}}», который
    // i18next не знает, чем заполнить.
    const instance = i18n.createInstance();
    await instance.init({
      lng: language,
      resources: { [language]: { translation: translations } },
      interpolation: { escapeValue: false },
    });

    expect(instance.t('passwordMin', { min: MIN_PASSWORD_LENGTH })).toContain(
      String(MIN_PASSWORD_LENGTH)
    );
  });
});
