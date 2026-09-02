/**
 * Хранилище ключей на устройстве.
 *
 * Всё, что здесь лежит, никогда не покидает браузер: приватная часть
 * личности и ключи чатов. IndexedDB выбран не за удобство, а потому что
 * умеет хранить объекты `CryptoKey` — а значит приватный ключ можно
 * держать неизвлекаемым: код им пользуется, но вынести его не может даже
 * внедрённый чужой скрипт.
 *
 * Подложку можно подменить: тестам нужна память, а не база.
 */

const DB_NAME = 'craneapp_crypto';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

export interface IKeyStoreBackend {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('IndexedDB занята другим соединением — обновление схемы отложено');
    };
  });

  return dbPromise;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      })
  );
}

const indexedDbBackend: IKeyStoreBackend = {
  read: (key) => transact('readonly', (store) => store.get(key)),
  write: (key, value) => transact<void>('readwrite', (store) => store.put(value, key)),
  remove: (key) => transact<void>('readwrite', (store) => store.delete(key)),
  listKeys: async (prefix) => {
    const keys = await transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    return keys.map(String).filter((key) => key.startsWith(prefix));
  },
};

let backend: IKeyStoreBackend = indexedDbBackend;

export function readKey<T>(key: string): Promise<T | undefined> {
  return backend.read<T>(key);
}

export function writeKey(key: string, value: unknown): Promise<void> {
  return backend.write(key, value);
}

export function removeKey(key: string): Promise<void> {
  return backend.remove(key);
}

export function listKeys(prefix: string): Promise<string[]> {
  return backend.listKeys(prefix);
}

export async function removeKeysWithPrefix(prefix: string): Promise<void> {
  const keys = await listKeys(prefix);
  await Promise.all(keys.map((key) => removeKey(key)));
}

/** Хранилище в памяти: для тестов и для окружений без IndexedDB. */
export function useMemoryKeyStore(): void {
  const entries = new Map<string, unknown>();

  backend = {
    read: async <T>(key: string) => entries.get(key) as T | undefined,
    write: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (key) => {
      entries.delete(key);
    },
    listKeys: async (prefix) => [...entries.keys()].filter((key) => key.startsWith(prefix)),
  };
}

export function useIndexedDbKeyStore(): void {
  backend = indexedDbBackend;
}
