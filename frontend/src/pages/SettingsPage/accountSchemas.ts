import { z } from 'zod';

/**
 * Правила форм аккаунта.
 *
 * Собраны отдельно от разметки: их видно целиком, они проверяются тестом
 * без отрисовки формы и не расползаются по обработчикам отправки, где
 * раньше жили вперемешку с запросами.
 */

/* Требование сервера — не менее шести знаков (auth/handler.go), но для
   пароля от аккаунта этого мало, поэтому здесь десять. Расхождение
   намеренное: клиент вправе быть строже сервера, наоборот — нет. */
const MIN_PASSWORD = 10;

export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль'),
    newPassword: z.string().min(MIN_PASSWORD, `Не менее ${MIN_PASSWORD} символов`),
    confirmation: z.string().min(1, 'Повторите новый пароль'),
  })
  .refine((values) => values.newPassword === values.confirmation, {
    message: 'Пароли не совпадают',
    path: ['confirmation'],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'Новый пароль совпадает с текущим',
    path: ['newPassword'],
  });

export const profileFormSchema = z.object({
  firstName: z.string().trim().min(1, 'Имя не может быть пустым').max(64, 'Слишком длинное имя'),
  lastName: z.string().trim().max(64, 'Слишком длинная фамилия'),
  /* Столько же, сколько считает счётчик под полем: разойдись они — человек
     увидит «0 / 160» и запрет одновременно. */
  bio: z.string().trim().max(160, 'Не больше 160 символов'),
});

export type TPasswordForm = z.infer<typeof passwordFormSchema>;
export type TProfileForm = z.infer<typeof profileFormSchema>;
