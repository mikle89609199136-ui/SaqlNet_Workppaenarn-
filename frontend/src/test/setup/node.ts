/**
 * Подготовка окружения `node`. Сюда попадают тесты, которым нужна настоящая
 * криптография: под jsdom `crypto.subtle.importKey` падает с TypeError,
 * потому что jsdom не признаёт ArrayBuffer, созданный вне своего realm.
 *
 * DOM здесь недоступен намеренно. Из браузерных API подменяется только то,
 * без чего не импортируются модули приложения.
 */
import { beforeEach } from 'vitest';

/** Хранилище в памяти: `entities/user/model/profileStore.ts` читает localStorage при импорте. */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  } as Storage;
}

globalThis.localStorage = createMemoryStorage();

beforeEach(() => {
  localStorage.clear();
});
