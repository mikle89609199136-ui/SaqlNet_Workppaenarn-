import { STORAGE_KEYS } from '@/shared/config';
import { useProfileStore } from '@/entities/user/model/profileStore';

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

function accountId(): string | null {
  try {
    const fromStore = useProfileStore.getState().user?.id;
    if (fromStore) return fromStore;
    const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null');
    return user?.id || null;
  } catch {
    return null;
  }
}

export function hasTranslatorConsent(): boolean {
  const id = accountId();
  if (!id) return false;
  try {
    return localStorage.getItem(`${CONSENT_PREFIX}${id}`) === 'yes';
  } catch {
    return false;
  }
}

export function rememberTranslatorConsent(): void {
  const id = accountId();
  if (!id) return;
  try {
    localStorage.setItem(`${CONSENT_PREFIX}${id}`, 'yes');
  } catch {
    // Хранилище может быть недоступно — тогда спросим в следующий раз.
  }
}
