import type { TFunction } from 'i18next';
import { z } from 'zod';

/**
 * Облачный пароль.
 *
 * Требования проще, чем у пароля входа, и строже по длине: этот пароль
 * перебирают без ограничения попыток по копии на сервере, и защищает его
 * прежде всего длина. Фраза из нескольких слов подходит лучше, чем
 * короткий пароль со спецсимволами, поэтому пробелы разрешены.
 */
export const MIN_CLOUD_PASSWORD_LENGTH = 12;
const MAX_CLOUD_PASSWORD_LENGTH = 256;

const createCloudPasswordValue = (t: TFunction) =>
  z
    .string()
    .refine((value) => [...value].length >= MIN_CLOUD_PASSWORD_LENGTH, {
      message: t('password.rule.length', {
        min: MIN_CLOUD_PASSWORD_LENGTH,
        defaultValue: 'Не менее {{min}} символов',
      }),
    })
    .refine((value) => [...value].length <= MAX_CLOUD_PASSWORD_LENGTH, {
      message: t('password.error.tooLong', {
        max: MAX_CLOUD_PASSWORD_LENGTH,
        defaultValue: 'Не более {{max}} символов',
      }),
    })
    .refine((value) => new Set(value).size >= 5, {
      message: t('validation.cloudPasswordMonotonous', 'Слишком однообразный пароль'),
    });

/** Фабрика, а не готовая схема: сообщения — на языке интерфейса. */
export const createCloudPasswordFormSchema = (t: TFunction) =>
  z
    .object({
      password: createCloudPasswordValue(t),
      confirmation: z.string().min(1, t('validation.repeatPassword', 'Повторите пароль')),
    })
    .refine((values) => values.password === values.confirmation, {
      message: t('validation.passwordsMismatch', 'Пароли не совпадают'),
      path: ['confirmation'],
    });

export type TCloudPasswordForm = z.infer<ReturnType<typeof createCloudPasswordFormSchema>>;

/**
 * Грубая оценка стойкости для полоски под полем: длина и разнообразие.
 * Проверкой не служит — форма пропускает всё, что прошло схему.
 */
export function cloudPasswordScore(value: string): number {
  const length = [...value].length;
  const kinds = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\p{L}\d]/u].filter((rule) =>
    rule.test(value)
  ).length;

  if (length < MIN_CLOUD_PASSWORD_LENGTH) return length > 0 ? 1 : 0;
  if (length >= 20 || (length >= 16 && kinds >= 3)) return 4;
  if (length >= 16 || kinds >= 3) return 3;
  return 2;
}
