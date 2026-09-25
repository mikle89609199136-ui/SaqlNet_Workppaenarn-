import { z } from 'zod';
import { passwordSchema } from '@/shared/lib';

/**
 * Правила смены пароля.
 */
export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль'),
    /* Те же требования, что при регистрации: разойдись они, пароль,
       годный при заведении аккаунта, нельзя было бы поставить при смене. */
    newPassword: passwordSchema,
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

export type TPasswordForm = z.infer<typeof passwordFormSchema>;
