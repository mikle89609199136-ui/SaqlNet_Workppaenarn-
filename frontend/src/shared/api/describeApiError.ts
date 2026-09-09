import type { TFunction } from 'i18next';

/**
 * Что показать человеку вместо серверной строки.
 *
 * Сервер отвечает кодом и английским пояснением: `member_muted` —
 * «member is muted». Пояснение написано для разработчика и попадало в
 * интерфейс как есть, потому что клиент брал `message` из ответа.
 *
 * Переводится по коду. Незнакомый код — общая фраза: лучше честное «не
 * получилось», чем английская строка, которой человек не ждал.
 */

type TErrorLike = { code?: string; message?: string } | null | undefined;

/** Коды, которые доходят до человека. Остальные — внутренние. */
const MESSAGES: Record<string, { key: string; fallback: string }> = {
  member_muted: {
    key: 'errors.memberMuted',
    fallback: 'В этом чате вам запрещено писать',
  },
  access_denied: { key: 'errors.accessDenied', fallback: 'Нет доступа' },
  blocked_by_user: {
    key: 'errors.blockedByUser',
    fallback: 'Этот человек ограничил переписку с вами',
  },
  chat_not_found: { key: 'errors.chatNotFound', fallback: 'Чат не найден' },
  not_found: { key: 'errors.notFound', fallback: 'Не найдено' },
  user_not_found: { key: 'errors.userNotFound', fallback: 'Пользователь не найден' },
  member_not_found: { key: 'errors.memberNotFound', fallback: 'Участник не найден' },
  validation_failed: { key: 'errors.validationFailed', fallback: 'Проверьте заполненные поля' },
  invalid_credentials: {
    key: 'errors.invalidCredentials',
    fallback: 'Неверное имя пользователя или пароль',
  },
  wrong_password: { key: 'errors.wrongPassword', fallback: 'Неверный пароль' },
  weak_password: { key: 'errors.weakPassword', fallback: 'Пароль слишком простой' },
  username_taken: { key: 'errors.usernameTaken', fallback: 'Это имя уже занято' },
  file_too_large: { key: 'errors.fileTooLarge', fallback: 'Файл слишком большой' },
  invalid_file: { key: 'errors.invalidFile', fallback: 'Такой файл загрузить нельзя' },
  unsupported_type: {
    key: 'errors.unsupportedType',
    fallback: 'Такой тип файла не поддерживается',
  },
  rate_limited: { key: 'errors.rateLimited', fallback: 'Слишком часто — попробуйте позже' },
};

/**
 * @param fallback что показать, если код неизвестен. Обычно у места
 * вызова есть слова точнее общих: «Не удалось закрепить сообщение»
 * полезнее, чем «Не получилось».
 */
export function describeApiError(error: TErrorLike, t: TFunction, fallback?: string): string {
  const known = error?.code ? MESSAGES[error.code] : undefined;

  if (known) return t(known.key, known.fallback);

  /* Серверный текст не показывается никогда — только в консоль, где он и
     нужен: по нему разработчик поймёт, какой код стоит перевести. */
  if (error?.code) {
    console.warn(`Ошибка без перевода: ${error.code} — ${error.message ?? ''}`);
  }

  return fallback ?? t('errors.generic', 'Не получилось. Попробуйте ещё раз');
}
