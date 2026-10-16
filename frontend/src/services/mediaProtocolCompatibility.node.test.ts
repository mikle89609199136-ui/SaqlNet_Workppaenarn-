import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { protocolVectors as vectors } from '@/test/fixtures/e2eProtocolVectors';
import { BackupTestServer } from '@/test/fixtures/backupServer';
import { STORAGE_KEYS } from '@/shared/config';
import {
  base64ToBytes,
  forgetDerivedKeys,
  forgetPeerIdentities,
  useMemoryKeyStore,
  writeKey,
} from '@/shared/crypto';
import { CryptoService } from './CryptoService';

beforeEach(() => {
  useMemoryKeyStore();
  forgetDerivedKeys();
  forgetPeerIdentities();
});

let mediaService: CryptoService | null = null;

afterEach(() => {
  mediaService?.forgetSession();
  mediaService = null;
  vi.restoreAllMocks();
});

async function createMediaService(): Promise<CryptoService> {
  const accountId = vectors.recipient.accountId;
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: accountId }));
  mediaService = new CryptoService(new BackupTestServer().client(accountId), {
    argon2: { m: 256, t: 1, p: 1 },
  });
  await mediaService.setupBackup('public test cloud password');
  // A saved epoch on an unlocked device. Use real storage/key-manager lookup;
  // no crypto methods or private fields are mocked.
  await writeKey(`chatkey:${accountId}:${vectors.chatId}:${vectors.epoch}`, vectors.chatKey);
  await writeKey(`chatkey-latest:${accountId}:${vectors.chatId}`, vectors.epoch);
  return mediaService;
}

describe('complete frozen media envelope compatibility (#707)', () => {
  it('reads the complete saved media v2 envelope through CryptoService', async () => {
    const service = await createMediaService();
    const plaintext = await service.decryptMedia(vectors.chatId, vectors.media.payload);
    expect(plaintext.type).toBe(vectors.media.payload.mimeType);
    expect(plaintext.size).toBe(vectors.media.payload.sizeBytes);
    expect(Array.from(new Uint8Array(await plaintext.arrayBuffer()))).toEqual(
      vectors.media.plaintext
    );
  });

  it('writes the complete frozen media v2 envelope through CryptoService', async () => {
    const service = await createMediaService();
    vi.spyOn(crypto, 'getRandomValues').mockReturnValueOnce(
      base64ToBytes(vectors.media.payload.iv)
    );
    const payload = await service.encryptMedia(
      vectors.chatId,
      new Blob([new Uint8Array(vectors.media.plaintext)], { type: vectors.media.payload.mimeType })
    );
    expect(payload).toEqual(vectors.media.payload);
  });
});
