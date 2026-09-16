import { z } from 'zod';
import { passwordSchema } from '@/shared/lib/passwordRules';

/**
 * Правила регистрации.
 *
 * Форма одна на все три шага, поэтому и схема одна: значения не теряются
 * при возврате назад, а проверка запускается по нужной части через
 * `trigger`. Список полей каждого шага лежит здесь же — рядом с
 * правилами, а не в разметке, где его пришлось бы искать.
 */

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export const registerFormSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Введите имя').max(64, 'Слишком длинное имя'),
    /* Необязательна: в профиле её тоже можно не заполнять, и требовать
       фамилию при заведении аккаунта — лишний повод бросить регистрацию. */
    lastName: z.string().trim().max(64, 'Слишком длинная фамилия'),
    username: z
      .string()
      .trim()
      .min(3, 'Не менее 3 символов')
      .max(32, 'Не более 32 символов')
      .regex(USERNAME_PATTERN, 'Только латинские буквы, цифры и _'),
    password: passwordSchema,
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
  about: ['firstName', 'lastName'],
  credentials: ['username', 'password', 'passwordRepeat'],
} as const satisfies Record<string, readonly (keyof TRegisterForm)[]>;

export type TRegisterStep = keyof typeof STEP_FIELDS;

export const REGISTER_STEPS: TRegisterStep[] = ['welcome', 'about', 'credentials'];
