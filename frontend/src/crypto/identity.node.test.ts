import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/shared/api/ApiClient';
import { bytesToBase64 } from './encoding';
import {
  decodeBundle,
  encodeBundle,
  fetchPeerIdentity,
  fingerprintOfBundle,
  forgetPeerIdentities,
  loadOrCreateIdentity,
  publishIdentity,
} from './identity';
import { useMemoryKeyStore } from './keyStore';

/**
 * Криптография здесь настоящая: файл выполняется в окружении node, где
 * WebCrypto работает без оговорок. Под jsdom `importKey` падает на буферах,
 * созданных вне его realm.
 */

interface IRequest {
  url: string;
  body: unknown;
}

function createApiStub(responses: Record<string, unknown> = {}) {
  const requests: IRequest[] = [];

  const apiClient = {
    post: async (url: string, body: unknown) => {
      requests.push({ url, body });
      return { data: { ok: true } };
    },
    get: async (url: string) => {
      requests.push({ url, body: null });

      const response = responses[url];
      if (!response) throw Object.assign(new Error('нет ключа'), { status: 404 });

      return { data: response };
    },
  } as unknown as ApiClient;

  return { apiClient, requests };
}

beforeEach(() => {
  useMemoryKeyStore();
  forgetPeerIdentities();
});

describe('личность аккаунта', () => {
  it('should keep the same identity across calls', async () => {
    // Новая пара при каждом входе означала бы, что вся переписка стала
    // нечитаемой, а собеседники увидели смену ключа на пустом месте.
    const first = await loadOrCreateIdentity('alice');
    const second = await loadOrCreateIdentity('alice');

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.bundle).toBe(first.bundle);
  });

  it('should refuse to export the private key', async () => {
    // Смысл неизвлекаемого ключа: внедрённый скрипт может им пользоваться,
    // пока открыта вкладка, но не может унести его с собой.
    const identity = await loadOrCreateIdentity('alice');

    await expect(crypto.subtle.exportKey('pkcs8', identity.ecdhPrivate)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', identity.ecdsaPrivate)).rejects.toThrow();
  });

  it('should be able to verify with the published key', async () => {
    // Список прав раздаётся паре: приватному достаётся подпись, публичному
    // проверка. С одним лишь 'sign' публичный ключ остаётся без прав, и
    // подпись не проверяется ничем — а выглядит это как «подпись не сошлась».
    const identity = await loadOrCreateIdentity('alice');

    expect(identity.ecdsa.usages).toContain('verify');
    expect(identity.ecdsaPrivate.usages).toContain('sign');
  });

  it('should carry both keys through the bundle', async () => {
    const identity = await loadOrCreateIdentity('alice');
    const decoded = await decodeBundle(identity.bundle);

    expect(decoded).not.toBeNull();
    expect(decoded?.fingerprint).toBe(identity.fingerprint);
    expect(decoded?.ecdh.algorithm.name).toBe('ECDH');
    expect(decoded?.ecdsa.algorithm.name).toBe('ECDSA');
  });

  it('should produce a fingerprint that fits the server field', async () => {
    // Отпечаток уходит в поле keyId, которое сервер принимает от 16 до 128
    // символов. base64url от SHA-256 даёт ровно 43.
    const identity = await loadOrCreateIdentity('alice');

    expect(identity.fingerprint).toHaveLength(43);
    expect(identity.fingerprint).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await fingerprintOfBundle(identity.bundle)).toBe(identity.fingerprint);
  });

  it('should treat a key from the previous scheme as no identity', async () => {
    // Прежняя схема публиковала одиночный ключ без связки. Разобрать его
    // нельзя, и это не ошибка: для такого человека ключ чата не завернуть,
    // пока он не войдёт с новой версией.
    const legacy = bytesToBase64(new Uint8Array([1, 2, 3, 4]));

    expect(await decodeBundle(legacy)).toBeNull();
  });

  it('should publish the bundle to both key routes', async () => {
    // Таблиц публичных ключей на сервере пока две: одна отдаёт ключ в
    // составе чата, другая знает про отпечаток. Какая останется — решает
    // бэкенд, а до тех пор пишем в обе.
    const { apiClient, requests } = createApiStub();
    const identity = await loadOrCreateIdentity('alice');

    await publishIdentity(apiClient, identity);

    expect(requests.map((request) => request.url)).toEqual([
      '/encryption/keys',
      '/auth/public-key',
    ]);
    expect(requests[0].body).toEqual({
      publicKey: identity.bundle,
      keyId: identity.fingerprint,
    });
  });
});

describe('связка собеседника', () => {
  it('should compute the fingerprint itself, not trust the server', async () => {
    // keyId выбирает тот, кто публикует ключ. Проверять по нему подлинность
    // собеседника — то же самое, что верить человеку на слово о том, кто он.
    const identity = await loadOrCreateIdentity('boris');
    const { apiClient } = createApiStub({
      '/encryption/keys/boris': { publicKey: identity.bundle, keyId: 'подставленный-отпечаток' },
    });

    const peer = await fetchPeerIdentity(apiClient, 'boris');

    expect(peer?.fingerprint).toBe(identity.fingerprint);
  });

  it('should ask the server once and remember the answer', async () => {
    const identity = await loadOrCreateIdentity('boris');
    const { apiClient, requests } = createApiStub({
      '/encryption/keys/boris': { publicKey: identity.bundle },
    });

    await fetchPeerIdentity(apiClient, 'boris');
    await fetchPeerIdentity(apiClient, 'boris');

    expect(requests).toHaveLength(1);
  });

  it('should report no identity when the server has none', async () => {
    const { apiClient } = createApiStub();

    expect(await fetchPeerIdentity(apiClient, 'кто-то')).toBeNull();
  });
});
