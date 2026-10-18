import { STORAGE_KEYS } from '@/shared/config';
import type { ApiClient } from './ApiClient';
import { apiClient } from './apiFactory';
import { API_ENDPOINTS } from './endpoints';

/*
 * Сессия браузера (#705). Токен — в HttpOnly-cookie: его ставит сервер при
 * входе, отправляет браузер, а JavaScript не видит вовсе. Клиенту остаётся
 * знать лишь, вошёл ли человек, — по сохранённому профилю: вход его пишет,
 * выход стирает; истёкшая сессия — ответ 401 и выход, как раньше.
 */

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Вошёл ли человек (есть сохранённый профиль). */
export function hasStoredSession(): boolean {
  return Boolean(storage()?.getItem(STORAGE_KEYS.USER));
}

/** Удаляет оставшийся от версии до #705 токен, не используя его в JS. */
export function clearLegacySessionToken(): void {
  try {
    storage()?.removeItem(STORAGE_KEYS.LEGACY_TOKEN);
  } catch {
    // В приватном режиме некоторые браузеры запрещают доступ к storage.
  }
}

/**
 * Жива ли сессия на сервере (#1070) — для сокета, который не может
 * подключиться. Код ответа рукопожатия браузер скрипту не отдаёт: отказ по
 * отозванной сессии и обрыв сети для сокета выглядят одинаково.
 *
 * `false` — только на 401: тогда клиент API сам сообщит о выходе, и
 * приложение уведёт на вход обычным путём. Сеть, 5xx и прочее — `true`:
 * проверить не удалось, пусть сокет пробует дальше.
 */
export async function isSessionAlive(client: ApiClient = apiClient): Promise<boolean> {
  try {
    await client.get(API_ENDPOINTS.USERS_ME);
    return true;
  } catch (error) {
    return (error as { status?: number })?.status !== 401;
  }
}
