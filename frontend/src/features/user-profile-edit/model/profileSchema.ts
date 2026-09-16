import { z } from 'zod';

/**
 * Правила формы профиля.
 */
export const profileFormSchema = z.object({
  firstName: z.string().trim().min(1, 'Имя не может быть пустым').max(64, 'Слишком длинное имя'),
  lastName: z.string().trim().max(64, 'Слишком длинная фамилия'),
  /* Столько же, сколько считает счётчик под полем: разойдись они — человек
     увидит «0 / 160» и запрет одновременно. */
  bio: z.string().trim().max(160, 'Не больше 160 символов'),
});

export type TProfileForm = z.infer<typeof profileFormSchema>;
