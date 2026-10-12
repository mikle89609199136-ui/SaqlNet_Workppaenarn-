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
const MESSAGES: Record<string, string> = {
  access_denied: 'errors.accessDenied',
  blocked_by_user: 'errors.blockedByUser',
  chat_not_found: 'errors.chatNotFound',
  file_too_large: 'errors.fileTooLarge',
  invalid_2fa: 'errors.invalid2fa',
  invalid_credentials: 'errors.invalidCredentials',
  invalid_file: 'errors.invalidFile',
  member_muted: 'errors.memberMuted',
  member_not_found: 'errors.memberNotFound',
  not_found: 'errors.notFound',
  not_member: 'errors.notMember',
  ownership_conflict: 'errors.ownershipConflict',
  rate_limited: 'errors.rateLimited',
  unsupported_type: 'errors.unsupportedType',
  user_not_found: 'errors.userNotFound',
  username_change_cooldown: 'errors.usernameChangeCooldown',
  username_taken: 'errors.usernameTaken',
  validation_failed: 'errors.validationFailed',
  weak_password: 'errors.weakPassword',
  wrong_password: 'errors.wrongPassword',
};

/**
 * @param fallback что показать, если код неизвестен. Обычно у места
 * вызова есть слова точнее общих: «Не удалось закрепить сообщение»
 * полезнее, чем «Не получилось».
 */
export function describeApiError(error: TErrorLike, t: TFunction, fallback?: string): string {
  const key = error?.code ? MESSAGES[error.code] : undefined;

  if (key) return t(key);

  /* Серверный текст не показывается никогда — только в консоль, где он и
     нужен: по нему разработчик поймёт, какой код стоит перевести. */
  if (error?.code) {
    console.warn(`Ошибка без перевода: ${error.code} — ${error.message ?? ''}`);
  }

  return fallback ?? t('errors.generic', 'Не получилось. Попробуйте ещё раз');
}
