import { z } from 'zod';

/**
 * Требования к паролю — копия серверных.
 *
 * Источник правды здесь не наш: политику задаёт
 * `backend-v2/internal/auth/password_validator.go`, и она одна на
 * регистрацию, смену пароля и второй пароль. Клиент повторяет её слово
 * в слово, чтобы человек узнавал о несоответствии до отправки, а не из
 * ответа сервера.
 *
 * Расхождение в любую сторону вредит: мягче — форма отправит то, что
 * сервер отвергнет, и человек получит невнятную ошибку; строже — не даст
 * ввести пароль, который сервер бы принял. Меняются требования — сперва
 * на сервере, потом здесь.
 *
 * Оговорка на будущее: действующая редакция NIST SP 800-63B требований к
 * составу не советует — их обходят предсказуемо («Parol123!»), а
 * запоминаемость падает; вместо этого предлагается длина и сверка со
 * списками утёкших. Это разговор про серверную политику, не про клиент.
 */

/** `minPasswordLength` в password_validator.go. */
export const MIN_PASSWORD_LENGTH = 10;

/** `maxPasswordLength` там же. Считается в символах, не в байтах. */
export const MAX_PASSWORD_LENGTH = 64;

/**
 * `passwordSpecialCharacters` оттуда же, символ в символ.
 *
 * Именно список, а не «всё, что не буква и не цифра»: сервер считает
 * знаком только это, и «№», «€» или длинное тире он не засчитает. Свой,
 * более широкий набор означал бы, что форма пропускает пароль, который
 * сервер отвергнет.
 */
const SPECIAL_CHARACTERS = '!@#$%^&*()_+-=[]{}|;:\'",.<>/?`~';

export interface IPasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

/**
 * Что человеку нужно сделать, чтобы пароль приняли.
 *
 * Показывается списком под полем. Сюда входят только достижимые
 * требования: запреты (длиннее шестидесяти четырёх, пробел внутри)
 * выполнены по умолчанию, и держать их в списке значило бы с первого
 * символа показывать две зелёные галочки ни о чём. Их проверяет схема и
 * сообщает, только когда нарушены.
 */
export const PASSWORD_RULES: IPasswordRule[] = [
  {
    id: 'length',
    label: `Не менее ${MIN_PASSWORD_LENGTH} символов`,
    test: (value) => [...value].length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: 'digit',
    label: 'Цифра',
    test: (value) => /\d/.test(value),
  },
  {
    id: 'special',
    label: `Знак из ${SPECIAL_CHARACTERS.slice(0, 8)} и подобных`,
    test: (value) => [...value].some((character) => SPECIAL_CHARACTERS.includes(character)),
  },
];

/** Какие требования выполнены для этого значения. */
export function checkPassword(value: string): Record<string, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((rule) => [rule.id, rule.test(value)]));
}

/**
 * Сколько требований выполнено — им же меряется полоска под полем.
 *
 * Считать силу своим набором признаков нельзя: полоска доходила бы до
 * конца у пароля, который форма не принимает.
 */
export function getPasswordScore(value: string): number {
  return PASSWORD_RULES.filter((rule) => rule.test(value)).length;
}

/**
 * Схема пароля.
 *
 * Порядок проверок тот же, что у сервера (`ValidatePassword`): сначала
 * длина, потом пробелы, потом состав. Сообщение называет ближайшее
 * невыполненное требование, а не всё разом.
 */
export const passwordSchema = z
  .string()
  .refine((value) => [...value].length >= MIN_PASSWORD_LENGTH, {
    message: `Не менее ${MIN_PASSWORD_LENGTH} символов`,
  })
  .refine((value) => [...value].length <= MAX_PASSWORD_LENGTH, {
    message: `Не более ${MAX_PASSWORD_LENGTH} символов`,
  })
  .refine((value) => !/\s/.test(value), {
    message: 'Без пробелов',
  })
  .refine((value) => /\d/.test(value), { message: 'Нужна цифра' })
  .refine((value) => [...value].some((character) => SPECIAL_CHARACTERS.includes(character)), {
    message: 'Нужен знак: ! @ # $ % и подобные',
  });
