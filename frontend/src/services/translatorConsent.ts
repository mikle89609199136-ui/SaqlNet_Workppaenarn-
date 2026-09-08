import { STORAGE_KEYS } from '@/shared/config';

/**
 * Согласие на перевод сообщений.
 *
 * Перевод отправляет расшифрованный текст сообщения в Google. Это не
 * ошибка и не утечка — так работает сама функция, — но человек, которому
 * приложение обещает сквозное шифрование, вправе узнать об этом до того,
 * как текст уйдёт, а не после.
 *
 * Спрашиваем один раз на аккаунт: спрашивать на каждое сообщение значит
 * приучить нажимать «да» не читая.
 */

const CONSENT_PREFIX = 'craneapp_translator_consent:';

function accountId(): string {
  try {
    const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null');
    return user?.id || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function hasTranslatorConsent(): boolean {
  try {
    return localStorage.getItem(`${CONSENT_PREFIX}${accountId()}`) === 'yes';
  } catch {
    return false;
  }
}

export function rememberTranslatorConsent(): void {
  try {
    localStorage.setItem(`${CONSENT_PREFIX}${accountId()}`, 'yes');
  } catch {
    // Хранилище может быть недоступно — тогда спросим в следующий раз.
  }
}
