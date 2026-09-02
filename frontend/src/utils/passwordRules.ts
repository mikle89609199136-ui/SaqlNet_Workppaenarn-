import { z } from 'zod';

/**
 * Требования к паролю — одни на всё приложение.
 *
 * Держать их в двух местах нельзя: разойдись пороги, и пароль, годный
 * при регистрации, нельзя будет поставить при смене. Поэтому и
 * регистрация, и настройки берут схему отсюда.
 *
 * Оговорка на будущее: действующая редакция NIST SP 800-63B требований
 * к составу не советует — люди обходят их предсказуемо («Parol123!»),
 * а запоминаемость падает. Стандарт предлагает вместо этого длину и
 * сверку со списками утёкших паролей. Состав здесь — осознанное решение
 * владельца, а не недосмотр; список утёкших к нему стоит добавить, когда
 * появится, чем угодно его заменять.
 */

/* Столько же принимает сервер (auth/handler.go). Клиент вправе быть
   строже сервера, наоборот — нет. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Требования по одному, каждое со своей проверкой.
 *
 * Список, а не единая регулярка: человеку под полем показывается, что
 * именно осталось сделать, а сообщение об ошибке собирается из тех же
 * правил — расхождению между подсказкой и запретом взяться неоткуда.
 */
export const PASSWORD_RULES = [
  {
    id: 'length',
    label: `Не менее ${MIN_PASSWORD_LENGTH} символов`,
    test: (value: string) => value.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: 'uppercase',
    label: 'Заглавная буква',
    test: (value: string) => /\p{Lu}/u.test(value),
  },
  {
    id: 'digit',
    label: 'Цифра',
    test: (value: string) => /\d/.test(value),
  },
  {
    id: 'symbol',
    label: 'Знак: !, ?, — и подобные',
    /* Всё, что не буква, не цифра и не пробел. Через свойства Unicode, а
       не списком: иначе знак с чужой раскладки — «№», «€», «—» — тихо
       не засчитался бы, хотя человек его честно набрал. */
    test: (value: string) => /[^\p{L}\p{N}\s]/u.test(value),
  },
] as const;

export type TPasswordRuleId = (typeof PASSWORD_RULES)[number]['id'];

/** Какие требования выполнены для этого значения. */
export function checkPassword(value: string): Record<TPasswordRuleId, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((rule) => [rule.id, rule.test(value)])) as Record<
    TPasswordRuleId,
    boolean
  >;
}

/**
 * Сколько требований выполнено — им же меряется полоска под полем.
 *
 * Раньше сила считалась своим набором признаков, не совпадавшим с тем,
 * что форма требует: полоска доходила до конца у пароля, который форма
 * не принимала.
 */
export function getPasswordScore(value: string): number {
  return PASSWORD_RULES.filter((rule) => rule.test(value)).length;
}

/**
 * Схема пароля.
 *
 * Проверки идут по одной и в том же порядке, что и подсказки под полем:
 * сообщение называет ближайшее невыполненное требование, а не всё разом.
 */
export const passwordSchema = PASSWORD_RULES.reduce(
  (schema, rule) => schema.refine(rule.test, { message: rule.label }),
  z.string() as z.ZodType<string>
);
