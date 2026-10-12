import type { TFunction } from 'i18next';
import { z } from 'zod';

/**
 * Правила формы входа.
 *
 * Проверок здесь намеренно мало. Вход — не место придираться к формату:
 * человек либо помнит свои данные, либо нет, и единственный судья тут
 * сервер. Требовать «имя из букв и цифр» на входе значит не пустить
 * того, кто зарегистрировался, когда правила были другими.
 *
 * Фабрика, а не готовая схема: сообщения — на языке интерфейса, и форма
 * пересобирает схему при смене языка.
 */
export const createLoginFormSchema = (t: TFunction) =>
  z.object({
    username: z
      .string()
      .trim()
      .min(1, t('validation.usernameRequired', 'Введите имя пользователя')),
    password: z.string().min(1, t('validation.passwordRequired', 'Введите пароль')),
  });

export type TLoginForm = z.infer<ReturnType<typeof createLoginFormSchema>>;
