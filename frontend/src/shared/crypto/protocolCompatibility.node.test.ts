import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/shared/api';
import type { IMessageEntity } from '@/shared/lib/richText';
import { protocolVectors as vectors } from '@/test/fixtures/e2eProtocolVectors';
import { ChatKeyManager } from './chatKeys';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from './encoding';
import {
  decryptMediaBytes,
  decryptMessage,
  encryptMediaBytes,
  encryptMessage,
  forgetDerivedKeys,
  parseEnvelope,
} from './envelope';
import { decodeBundle, forgetPeerIdentities, restorePortableIdentity } from './identity';
import { useMemoryKeyStore } from './keyStore';
import { signParts, verifyParts } from './signing';

// These ciphertexts/signatures were generated once by an independent Node
// crypto implementation. Tests must never generate their own expected bytes.
// Fixed IVs are restricted to this test; production always uses random IVs.
const chatKey = () => base64ToBytes(vectors.chatKey);
const voice = () => ({ durationMs: 1200, waveform: [1, 20, 31], gainDb: 3.5 });
const entities = () => vectors.v3.content.entities as IMessageEntity[];

beforeEach(() => {
  vi.restoreAllMocks();
  useMemoryKeyStore();
  forgetPeerIdentities();
  forgetDerivedKeys();
});

afterEach(() => vi.restoreAllMocks());

describe('frozen production protocol vectors (#707)', () => {
  for (const [name, vector] of [
    ['v2', vectors.v2],
    ['v3', vectors.v3],
  ] as const) {
    it(`reads saved ${name} ciphertext and verifies the saved sender signature`, async () => {
      const envelope = parseEnvelope(JSON.stringify(vector.envelope));
      expect(envelope).not.toBeNull();
      const sender = await decodeBundle(vectors.sender.bundle);
      expect(sender?.fingerprint).toBe(vectors.sender.fingerprint);
      expect(
        await decryptMessage(chatKey(), vectors.chatId, vectors.sender.accountId, envelope!)
      ).toEqual(
        name === 'v2'
          ? { text: vectors.v2.text, entities: [] }
          : { text: vectors.v3.content.text, entities: entities(), voice: voice() }
      );
      expect(
        await verifyParts(
          sender!.ecdsa,
          {
            chatId: vectors.chatId,
            epoch: vectors.epoch,
            senderId: vectors.sender.accountId,
            iv: envelope!.iv,
            data: envelope!.data,
          },
          envelope!.sig!
        )
      ).toBe(true);
    });

    it(`writes ${name} with the frozen HKDF, AAD, payload encoding and signature context`, async () => {
      const sender = await restorePortableIdentity(vectors.sender.accountId, vectors.sender);
      const random = vi
        .spyOn(crypto, 'getRandomValues')
        .mockReturnValueOnce(base64ToBytes(vector.envelope.iv));
      const wire = await encryptMessage(
        chatKey(),
        vectors.chatId,
        vectors.epoch,
        vectors.sender.accountId,
        name === 'v2' ? vectors.v2.text : vectors.v3.content.text,
        { fingerprint: sender.fingerprint, sign: (parts) => signParts(sender.ecdsaPrivate, parts) },
        name === 'v2' ? [] : entities(),
        name === 'v2' ? undefined : voice()
      );
      const envelope = parseEnvelope(wire)!;
      const { sig: _savedSignature, ...expected } = vector.envelope;
      expect(envelope).toMatchObject(expected);
      // ECDSA signatures vary; verify the newly written one against the frozen
      // input bytes rather than against the implementation's canonicalizer.
      expect(
        await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          sender.ecdsa,
          base64ToBytes(envelope.sig!),
          utf8ToBytes(vector.signingInput)
        )
      ).toBe(true);
      expect(random).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8Array));
    });
  }

  it('reads saved media bytes from the previous epoch', async () => {
    const media = vectors.media.payload;
    const plaintext = await decryptMediaBytes(
      chatKey(),
      vectors.chatId,
      media.keyEpoch,
      media.iv,
      media.ciphertext
    );
    expect(Array.from(new Uint8Array(plaintext))).toEqual(vectors.media.plaintext);
  });

  it('writes media with the frozen purpose key, AAD and GCM tag encoding', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockReturnValueOnce(
      base64ToBytes(vectors.media.payload.iv)
    );
    const payload = await encryptMediaBytes(
      chatKey(),
      vectors.chatId,
      vectors.epoch,
      new Uint8Array(vectors.media.plaintext).buffer
    );
    expect(payload).toEqual({
      iv: vectors.media.payload.iv,
      ciphertext: vectors.media.payload.ciphertext,
    });
  });

  it('opens a saved wrapped key through the actual key manager', async () => {
    const recipient = await restorePortableIdentity(vectors.recipient.accountId, vectors.recipient);
    const apiClient = {
      get: async (url: string) => {
        if (url === `/encryption/my-key/${vectors.chatId}`) return { data: vectors.wrappedKey };
        if (url === `/encryption/keys/${vectors.sender.accountId}`)
          return { data: { publicKey: vectors.sender.bundle } };
        throw new Error(`Unexpected GET ${url}`);
      },
    } as unknown as ApiClient;
    const manager = new ChatKeyManager({
      apiClient,
      identity: async () => recipient,
      members: async () => [recipient.accountId],
    });
    const saved = await manager.acceptFromServer(vectors.chatId);
    expect(saved?.epoch).toBe(vectors.epoch);
    expect(saved && bytesToBase64(saved.key)).toBe(vectors.chatKey);
  });

  it('writes the frozen ECDH/HKDF wrapped-key format through healing', async () => {
    const sender = await restorePortableIdentity(vectors.sender.accountId, vectors.sender);
    const post = vi.fn(async () => ({ data: { ok: true } }));
    const apiClient = {
      post,
      get: async (url: string) => {
        if (url === `/encryption/chat-keys/${vectors.chatId}`)
          return { data: { keys: [], keyEpoch: vectors.epoch, rotationNeeded: false } };
        if (url === `/encryption/keys/${vectors.recipient.accountId}`)
          return { data: { publicKey: vectors.recipient.bundle } };
        if (url === `/encryption/my-key/${vectors.chatId}`)
          throw Object.assign(new Error('not found'), { status: 404 });
        throw new Error(`Unexpected GET ${url}`);
      },
    } as unknown as ApiClient;
    const manager = new ChatKeyManager({
      apiClient,
      identity: async () => sender,
      members: async () => [vectors.recipient.accountId],
    });
    await manager.importFromBackup(vectors.chatId, [{ key: chatKey(), epoch: vectors.epoch }]);
    vi.spyOn(crypto, 'getRandomValues').mockReturnValueOnce(base64ToBytes(vectors.wrapIv));
    await manager.heal(vectors.chatId);
    expect(post).toHaveBeenCalledExactlyOnceWith(`/encryption/chat-keys/${vectors.chatId}`, {
      encryptedKeys: [vectors.wrappedKey],
      keyEpoch: vectors.epoch,
    });
  });
});
