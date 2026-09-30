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

/**
 * Переход на cookie без повторного входа. Вошедший до #705 хранит токен в
 * localStorage; один раз меняем его на cookie сессии и стираем. Вызывается
 * при запуске, до первого запроса: иначе запросы ушли бы без сессии и
 * вернули 401.
 *
 * Сервер токен не принял (истёк, отозван) — сессии нет: стираем и профиль,
 * будет вход. Нет сети — оставляем, попробуем при следующем запуске.
 */
export async function exchangeLegacySession(client: ApiClient = apiClient): Promise<void> {
  const store = storage();
  const token = store?.getItem(STORAGE_KEYS.LEGACY_TOKEN);
  if (!store || !token) return;
  try {
    await client.post(API_ENDPOINTS.AUTH_SESSION, undefined, { Authorization: `Bearer ${token}` });
    store.removeItem(STORAGE_KEYS.LEGACY_TOKEN);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 401 || status === 403) {
      store.removeItem(STORAGE_KEYS.LEGACY_TOKEN);
      store.removeItem(STORAGE_KEYS.USER);
    }
  }
}
