import { z } from 'zod';
import { USERNAME_PATTERN } from '@/entities/user';

/**
 * Правила формы профиля.
 */
export const profileFormSchema = z.object({
  firstName: z.string().trim().min(1, 'Имя не может быть пустым').max(64, 'Слишком длинное имя'),
  lastName: z.string().trim().max(64, 'Слишком длинная фамилия'),
  username: z
    .string()
    .trim()
    .min(3, 'Не менее 3 символов')
    .max(32, 'Не более 32 символов')
    .regex(USERNAME_PATTERN, 'Только латинские буквы, цифры и _'),
  /* Столько же, сколько считает счётчик под полем: разойдись они — человек
     увидит «0 / 160» и запрет одновременно. */
  bio: z.string().trim().max(160, 'Не больше 160 символов'),
});

export type TProfileForm = z.infer<typeof profileFormSchema>;
