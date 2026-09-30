import { STORAGE_KEYS } from '@/shared/config';

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
