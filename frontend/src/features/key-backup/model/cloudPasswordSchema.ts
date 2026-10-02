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

export const cloudPasswordValue = z
  .string()
  .refine((value) => [...value].length >= MIN_CLOUD_PASSWORD_LENGTH, {
    message: `Не менее ${MIN_CLOUD_PASSWORD_LENGTH} символов`,
  })
  .refine((value) => [...value].length <= MAX_CLOUD_PASSWORD_LENGTH, {
    message: `Не более ${MAX_CLOUD_PASSWORD_LENGTH} символов`,
  })
  .refine((value) => new Set(value).size >= 5, {
    message: 'Слишком однообразный пароль',
  });

export const cloudPasswordFormSchema = z
  .object({
    password: cloudPasswordValue,
    confirmation: z.string().min(1, 'Повторите пароль'),
  })
  .refine((values) => values.password === values.confirmation, {
    message: 'Пароли не совпадают',
    path: ['confirmation'],
  });

export type TCloudPasswordForm = z.infer<typeof cloudPasswordFormSchema>;

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
