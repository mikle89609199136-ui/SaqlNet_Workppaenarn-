import { beforeEach, describe, expect, it } from 'vitest';
import { bytesToBase64 } from './encoding';
import { createPortableIdentity, loadIdentity, restorePortableIdentity } from './identity';
import {
  createPasskeySlot,
  createPasswordSlot,
  generateMasterKey,
  isBackupSlot,
  openChatKey,
  openIdentity,
  openPasskeySlot,
  openPasswordSlot,
  sealChatKey,
  sealIdentity,
  type IArgon2Params,
} from './keyBackup';
import { useMemoryKeyStore } from './keyStore';

/**
 * Криптография настоящая: WebCrypto в node и Argon2id из hash-wasm.
 * Параметры Argon2 уменьшены, чтобы тесты не тратили по 64 МиБ на попытку;
 * устройство формулы от этого не меняется.
 */
const FAST_ARGON2: IArgon2Params = { m: 256, t: 1, p: 1 };

const ACCOUNT = 'account-1';

describe('резервная копия: мастер-ключ', () => {
  it('создаёт 32 случайных байта, каждый раз новые', () => {
    const first = generateMasterKey();
    const second = generateMasterKey();

    expect(first).toHaveLength(32);
    expect(bytesToBase64(first)).not.toBe(bytesToBase64(second));
  });
});

describe('резервная копия: личность', () => {
  beforeEach(() => {
    useMemoryKeyStore();
  });

  it('восстанавливает ту же личность из копии', async () => {
    const master = generateMasterKey();
    const portable = await createPortableIdentity();
    const identity = await restorePortableIdentity(ACCOUNT, portable);

    const sealed = await sealIdentity(master, ACCOUNT, portable);
    useMemoryKeyStore();
    const restored = await restorePortableIdentity(
      ACCOUNT,
      await openIdentity(master, ACCOUNT, sealed)
    );

    expect(restored.bundle).toBe(identity.bundle);
    expect(restored.fingerprint).toBe(identity.fingerprint);
    expect(await loadIdentity(ACCOUNT)).toMatchObject({ fingerprint: identity.fingerprint });
  });

  it('держит приватные ключи на устройстве неизвлекаемыми', async () => {
    const identity = await restorePortableIdentity(ACCOUNT, await createPortableIdentity());

    expect(identity.ecdhPrivate.extractable).toBe(false);
    expect(identity.ecdsaPrivate.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', identity.ecdhPrivate)).rejects.toThrow();
  });

  it('восстановленная личность разворачивает то, что завернула исходная', async () => {
    const master = generateMasterKey();
    const portable = await createPortableIdentity();
    const identity = await restorePortableIdentity(ACCOUNT, portable);
    const peer = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ]);
    const restored = await restorePortableIdentity(
      ACCOUNT,
      await openIdentity(master, ACCOUNT, await sealIdentity(master, ACCOUNT, portable))
    );

    const derive = (privateKey: CryptoKey) =>
      crypto.subtle.deriveBits({ name: 'ECDH', public: peer.publicKey }, privateKey, 256);

    expect(bytesToBase64(await derive(restored.ecdhPrivate))).toBe(
      bytesToBase64(await derive(identity.ecdhPrivate))
    );
  });

  it('не открывает личность чужим мастер-ключом', async () => {
    const portable = await createPortableIdentity();
    const sealed = await sealIdentity(generateMasterKey(), ACCOUNT, portable);

    await expect(openIdentity(generateMasterKey(), ACCOUNT, sealed)).rejects.toThrow();
  });

  it('не открывает личность, подложенную другому аккаунту', async () => {
    const master = generateMasterKey();
    const portable = await createPortableIdentity();
    const sealed = await sealIdentity(master, ACCOUNT, portable);

    await expect(openIdentity(master, 'account-2', sealed)).rejects.toThrow();
  });
});

describe('резервная копия: ключи чатов', () => {
  it('возвращает ключ чата той же эпохи', async () => {
    const master = generateMasterKey();
    const chatKey = crypto.getRandomValues(new Uint8Array(32));

    const sealed = await sealChatKey(master, 'chat-1', 3, chatKey);

    expect(bytesToBase64(await openChatKey(master, 'chat-1', 3, sealed))).toBe(
      bytesToBase64(chatKey)
    );
  });

  it('не даёт переставить ключ в другой чат или эпоху', async () => {
    const master = generateMasterKey();
    const sealed = await sealChatKey(master, 'chat-1', 3, new Uint8Array(32));

    await expect(openChatKey(master, 'chat-2', 3, sealed)).rejects.toThrow();
    await expect(openChatKey(master, 'chat-1', 4, sealed)).rejects.toThrow();
  });
});

describe('резервная копия: слоты', () => {
  it('открывает мастер-ключ облачным паролем', async () => {
    const master = generateMasterKey();
    const slot = await createPasswordSlot(master, 'длинный облачный пароль', FAST_ARGON2);

    const opened = await openPasswordSlot(slot, 'длинный облачный пароль');

    expect(opened && bytesToBase64(opened)).toBe(bytesToBase64(master));
    expect(slot.kdf).toEqual({ alg: 'argon2id', ...FAST_ARGON2 });
    expect(JSON.stringify(slot)).not.toContain('длинный');
  });

  it('отвечает null на неверный пароль', async () => {
    const slot = await createPasswordSlot(
      generateMasterKey(),
      'длинный облачный пароль',
      FAST_ARGON2
    );

    expect(await openPasswordSlot(slot, 'другой облачный пароль')).toBeNull();
  });

  it('не открывается, если сервер ослабил параметры Argon2', async () => {
    const slot = await createPasswordSlot(
      generateMasterKey(),
      'длинный облачный пароль',
      FAST_ARGON2
    );

    const weakened = { ...slot, kdf: { ...slot.kdf, t: 1, m: 64 } };

    expect(await openPasswordSlot(weakened, 'длинный облачный пароль')).toBeNull();
  });

  it('открывает мастер-ключ секретом passkey', async () => {
    const master = generateMasterKey();
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const slot = await createPasskeySlot(master, 'credential-1', new Uint8Array(32), prf);

    const opened = await openPasskeySlot(slot, prf);

    expect(opened && bytesToBase64(opened)).toBe(bytesToBase64(master));
    expect(await openPasskeySlot(slot, crypto.getRandomValues(new Uint8Array(32)))).toBeNull();
  });

  it('узнаёт слоты и отбрасывает мусор', async () => {
    const password = await createPasswordSlot(
      generateMasterKey(),
      'длинный облачный пароль',
      FAST_ARGON2
    );

    expect(isBackupSlot(password)).toBe(true);
    expect(isBackupSlot({ ...password, kdf: { alg: 'pbkdf2' } })).toBe(false);
    expect(isBackupSlot({ type: 'passkey', id: 'x' })).toBe(false);
    expect(isBackupSlot(null)).toBe(false);
  });
});
