import type { TFunction } from 'i18next';
import { z } from 'zod';
import { USERNAME_PATTERN } from '@/entities/user';

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const NAME_MAX = 64;
const BIO_MAX = 160;

/**
 * Правила формы профиля.
 *
 * Фабрика, а не готовая схема: сообщения — на языке интерфейса, и форма
 * пересобирает схему при смене языка.
 */
export const createProfileFormSchema = (t: TFunction) =>
  z.object({
    firstName: z
      .string()
      .trim()
      .min(1, t('validation.firstNameEmpty', 'Имя не может быть пустым'))
      .max(NAME_MAX, t('validation.firstNameTooLong', 'Слишком длинное имя')),
    lastName: z
      .string()
      .trim()
      .max(NAME_MAX, t('validation.lastNameTooLong', 'Слишком длинная фамилия')),
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
    /* Столько же, сколько считает счётчик под полем: разойдись они — человек
       увидит «0 / 160» и запрет одновременно. */
    bio: z
      .string()
      .trim()
      .max(
        BIO_MAX,
        t('validation.bioTooLong', { max: BIO_MAX, defaultValue: 'Не больше {{max}} символов' })
      ),
  });

export type TProfileForm = z.infer<ReturnType<typeof createProfileFormSchema>>;
