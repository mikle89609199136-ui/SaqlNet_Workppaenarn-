import type { TFunction } from 'i18next';
import { z } from 'zod';
import { createPasswordSchema } from '@/shared/lib';

/**
 * Правила смены пароля.
 *
 * Фабрика, а не готовая схема: сообщения — на языке интерфейса, и форма
 * пересобирает схему при смене языка.
 */
export const createPasswordFormSchema = (t: TFunction) =>
  z
    .object({
      currentPassword: z
        .string()
        .min(1, t('validation.currentPasswordRequired', 'Введите текущий пароль')),
      /* Те же требования, что при регистрации: разойдись они, пароль,
         годный при заведении аккаунта, нельзя было бы поставить при смене. */
      newPassword: createPasswordSchema(t),
      confirmation: z.string().min(1, t('validation.repeatNewPassword', 'Повторите новый пароль')),
    })
    .refine((values) => values.newPassword === values.confirmation, {
      message: t('validation.passwordsMismatch', 'Пароли не совпадают'),
      path: ['confirmation'],
    })
    .refine((values) => values.newPassword !== values.currentPassword, {
      message: t('validation.passwordSameAsCurrent', 'Новый пароль совпадает с текущим'),
      path: ['newPassword'],
    });

export type TPasswordForm = z.infer<ReturnType<typeof createPasswordFormSchema>>;
