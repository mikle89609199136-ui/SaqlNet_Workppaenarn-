import { z } from 'zod';

/**
 * Правила регистрации.
 *
 * Форма одна на все три шага, поэтому и схема одна: значения не теряются
 * при возврате назад, а проверка запускается по нужной части через
 * `trigger`. Список полей каждого шага лежит здесь же — рядом с
 * правилами, а не в разметке, где его пришлось бы искать.
 */

/* Столько же, сколько принимает сервер (auth/handler.go). В настройках
   смена пароля требует десять — там речь о пароле, который человек
   меняет осознанно, а на входной форме лишний порог отпугивает. */
const MIN_PASSWORD = 6;

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export const registerFormSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Введите имя').max(64, 'Слишком длинное имя'),
    username: z
      .string()
      .trim()
      .min(3, 'Не менее 3 символов')
      .max(32, 'Не более 32 символов')
      .regex(USERNAME_PATTERN, 'Только латинские буквы, цифры и _'),
    password: z.string().min(MIN_PASSWORD, `Не менее ${MIN_PASSWORD} символов`),
    passwordRepeat: z.string().min(1, 'Повторите пароль'),
  })
  .refine((values) => values.password === values.passwordRepeat, {
    message: 'Пароли не совпадают',
    path: ['passwordRepeat'],
  });

export type TRegisterForm = z.infer<typeof registerFormSchema>;

/**
 * Что проверяется перед переходом к следующему шагу.
 *
 * Приветствие полей не содержит — с него вперёд пускают без проверок.
 */
export const STEP_FIELDS = {
  welcome: [],
  name: ['firstName'],
  credentials: ['username', 'password', 'passwordRepeat'],
} as const satisfies Record<string, readonly (keyof TRegisterForm)[]>;

export type TRegisterStep = keyof typeof STEP_FIELDS;

export const REGISTER_STEPS: TRegisterStep[] = ['welcome', 'name', 'credentials'];

/**
 * Насколько пароль вообще похож на пароль — пять признаков, по одному
 * очку за каждый. Это подсказка человеку, а не проверка: форму держит
 * схема, а полоска под полем лишь показывает, куда двигаться.
 */
export function getPasswordScore(password: string): number {
  return [
    password.length >= 6,
    password.length >= MIN_PASSWORD,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
}
