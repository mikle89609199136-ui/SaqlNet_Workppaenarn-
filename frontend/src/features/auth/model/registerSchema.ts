import type { TFunction } from 'i18next';
import { z } from 'zod';
import { createPasswordSchema } from '@/shared/lib';
import { USERNAME_PATTERN } from '@/entities/user';

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const NAME_MAX = 64;

/**
 * Правила регистрации.
 *
 * Форма одна на все три шага, поэтому и схема одна: значения не теряются
 * при возврате назад, а проверка запускается по нужной части через
 * `trigger`. Список полей каждого шага лежит здесь же — рядом с
 * правилами, а не в разметке, где его пришлось бы искать.
 *
 * Фабрика, а не готовая схема: сообщения — на языке интерфейса, и форма
 * пересобирает схему при смене языка.
 */
export const createRegisterFormSchema = (t: TFunction) =>
  z
    .object({
      firstName: z
        .string()
        .trim()
        .min(1, t('validation.firstNameRequired', 'Введите имя'))
        .refine(
          (value) => [...value].length <= NAME_MAX,
          t('validation.firstNameTooLong', 'Слишком длинное имя')
        ),
      /* Необязательна: в профиле её тоже можно не заполнять, и требовать
         фамилию при заведении аккаунта — лишний повод бросить регистрацию. */
      lastName: z
        .string()
        .trim()
        .refine(
          (value) => [...value].length <= NAME_MAX,
          t('validation.lastNameTooLong', 'Слишком длинная фамилия')
        ),
      username: z
        .string()
        .trim()
        .min(
          USERNAME_MIN,
          t('validation.usernameTooShort', {
            min: USERNAME_MIN,
            defaultValue: 'Не менее {{min}} символов',
          })
        )
        .max(
          USERNAME_MAX,
          t('validation.usernameTooLong', {
            max: USERNAME_MAX,
            defaultValue: 'Не более {{max}} символов',
          })
        )
        .regex(
          USERNAME_PATTERN,
          t('validation.usernamePattern', 'Только латинские буквы, цифры и _')
        ),
      password: createPasswordSchema(t),
      passwordRepeat: z.string().min(1, t('validation.repeatPassword', 'Повторите пароль')),
    })
    .refine((values) => values.password === values.passwordRepeat, {
      message: t('validation.passwordsMismatch', 'Пароли не совпадают'),
      path: ['passwordRepeat'],
    });

export type TRegisterForm = z.infer<ReturnType<typeof createRegisterFormSchema>>;

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
