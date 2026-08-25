// @vitest-environment node
import { STORAGE_KEYS } from '@/consts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/api/ApiClient';
import { CryptoService } from './CryptoService';

// Окружение node, а не jsdom: под Node 20 jsdom не признаёт ArrayBuffer,
// созданный вне своего realm, и любой importKey падает с TypeError.
// DOM здесь не нужен — из браузерных API сервису требуются только WebCrypto
// и localStorage, второй подменяется ниже.
const memoryStorage = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, value);
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key);
  },
  clear: () => {
    memoryStorage.clear();
  },
  key: (index: number) => [...memoryStorage.keys()][index] ?? null,
  get length() {
    return memoryStorage.size;
  },
} as Storage;

// IndexedDB сервису тоже нужен, но его хранилище подменяется в createService.
// Сама криптография настоящая: WebCrypto доступен нативно.
function createService(accountId: string) {
  const apiClient = {
    post: async () => ({ data: {} }),
    get: async () => ({ data: {} }),
  } as unknown as ApiClient;

  const service = new CryptoService(apiClient);
  const storage = new Map<string, unknown>();

  service.initDB = async () => ({}) as IDBDatabase;
  service.dbGet = async <T>(key: string) => storage.get(key) as T | undefined;
  service.dbSet = async (key: string, value: unknown) => {
    storage.set(key, value);
  };

  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: accountId }));
  return service;
}

async function readyService(accountId: string) {
  const service = createService(accountId);
  await service.init();
  const publicKey = await service.exportPublicKey();
  return { service, publicKey: publicKey! };
}

describe('CryptoService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should decrypt own message after the peer replaced their key', async () => {
    const alice = await readyService('alice');
    const bobOld = await readyService('bob-old');

    const payload = await alice.service.encryptDM('привет', bobOld.publicKey);

    // Собеседник перевыпустил ключевую пару: сервер отдаёт уже новый ключ.
    const bobNew = await readyService('bob-new');

    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 'alice' }));
    const decrypted = await alice.service.decryptDM(payload, bobNew.publicKey, {
      preferEmbeddedSenderKey: false,
    });

    expect(decrypted).toBe('привет');
  });

  it('should decrypt an incoming message with the sender key from the payload', async () => {
    const alice = await readyService('alice');
    const bob = await readyService('bob');

    const payload = await alice.service.encryptDM('входящее', bob.publicKey);
    const decrypted = await bob.service.decryptDM(payload, alice.publicKey);

    expect(decrypted).toBe('входящее');
  });

  it('should refuse to send plaintext when the peer has no key', async () => {
    const alice = await readyService('alice');

    await expect(alice.service.encryptDM('секрет', '')).rejects.toThrow(/нет ключа шифрования/);
  });

  it('should keep the public key unsent when the upload request fails', async () => {
    const service = createService('alice');
    let attempts = 0;

    service['apiClient'] = {
      post: async () => {
        attempts += 1;
        throw new Error('network down');
      },
    } as unknown as ApiClient;

    await service.init();
    await service.uploadPublicKey();

    // Неудачная отправка не должна считаться выполненной: иначе собеседники
    // останутся без ключа до перезагрузки вкладки.
    expect(attempts).toBeGreaterThan(1);
  });
});
