import { beforeEach, describe, expect, it } from 'vitest';
import { encryptMessage, parseEnvelope } from './envelope';
import { loadOrCreateIdentity } from './identity';
import { useMemoryKeyStore } from './keyStore';
import { signParts, verifyParts, type ISignedParts } from './signing';

const CHAT = 'chat-1';
const EPOCH = 4;

function parts(overrides: Partial<ISignedParts> = {}): ISignedParts {
  return {
    chatId: CHAT,
    epoch: EPOCH,
    senderId: 'alice',
    iv: 'AAECAwQFBgcICQoL',
    data: 'c2hpZnJ0ZWtzdA==',
    ...overrides,
  };
}

function chatKey(seed = 5): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

beforeEach(() => {
  useMemoryKeyStore();
});

describe('подпись сообщения', () => {
  it('should confirm what it signed', async () => {
    const alice = await loadOrCreateIdentity('alice');
    const signature = await signParts(alice.ecdsaPrivate, parts());

    expect(await verifyParts(alice.ecdsa, parts(), signature)).toBe(true);
  });

  it('should not confirm a changed ciphertext', async () => {
    const alice = await loadOrCreateIdentity('alice');
    const signature = await signParts(alice.ecdsaPrivate, parts());

    expect(await verifyParts(alice.ecdsa, parts({ data: 'ZHJ1Z29lLXNvb2Jzag==' }), signature)).toBe(
      false
    );
  });

  it('should not confirm a rewritten author', async () => {
    // Автор входит в подписываемое: приписать сообщение другому человеку,
    // сохранив подпись, нельзя.
    const alice = await loadOrCreateIdentity('alice');
    const signature = await signParts(alice.ecdsaPrivate, parts());

    expect(await verifyParts(alice.ecdsa, parts({ senderId: 'boris' }), signature)).toBe(false);
  });

  it('should not confirm a message moved to another chat', async () => {
    const alice = await loadOrCreateIdentity('alice');
    const signature = await signParts(alice.ecdsaPrivate, parts());

    expect(await verifyParts(alice.ecdsa, parts({ chatId: 'chat-2' }), signature)).toBe(false);
  });

  it('should not confirm a message moved to another epoch', async () => {
    const alice = await loadOrCreateIdentity('alice');
    const signature = await signParts(alice.ecdsaPrivate, parts());

    expect(await verifyParts(alice.ecdsa, parts({ epoch: EPOCH + 1 }), signature)).toBe(false);
  });

  it('should not confirm a signature made by someone else', async () => {
    const alice = await loadOrCreateIdentity('alice');
    const mallory = await loadOrCreateIdentity('mallory');
    const signature = await signParts(mallory.ecdsaPrivate, parts());

    expect(await verifyParts(alice.ecdsa, parts(), signature)).toBe(false);
  });

  it('should treat nonsense as a signature that does not match', async () => {
    // Подпись приходит с сервера: она может быть чем угодно, и падать на
    // этом нельзя — иначе сообщение не отрисуется вовсе.
    const alice = await loadOrCreateIdentity('alice');

    expect(await verifyParts(alice.ecdsa, parts(), 'не base64 и не подпись')).toBe(false);
    expect(await verifyParts(alice.ecdsa, parts(), '')).toBe(false);
  });
});

describe('подделка сообщения участником группы', () => {
  it('should not confirm a message forged with the shared chat key', async () => {
    // Ключ чата есть у каждого участника, поэтому шифрование само по себе
    // не отвечает на вопрос, кто написал: Мэллори может собрать сообщение
    // от имени Алисы, и оно расшифруется как настоящее. Подпись — это
    // единственное, что отличает подделку.
    const alice = await loadOrCreateIdentity('alice');
    const mallory = await loadOrCreateIdentity('mallory');
    const sharedKey = chatKey();

    const forged = await encryptMessage(sharedKey, CHAT, EPOCH, 'alice', 'я согласен', {
      fingerprint: mallory.fingerprint,
      sign: (data) => signParts(mallory.ecdsaPrivate, data),
    });

    const envelope = parseEnvelope(forged)!;
    const checkedParts = {
      chatId: CHAT,
      epoch: envelope.epoch,
      senderId: 'alice',
      iv: envelope.iv,
      data: envelope.data,
    };

    // Ключом Алисы — не сходится: писала не она.
    expect(await verifyParts(alice.ecdsa, checkedParts, envelope.sig!)).toBe(false);
    // Ключом Мэллори сходится, но проверяют по ключу того, чьё имя стоит.
    expect(await verifyParts(mallory.ecdsa, checkedParts, envelope.sig!)).toBe(true);
  });

  it('should sign what it sends', async () => {
    const alice = await loadOrCreateIdentity('alice');

    const payload = await encryptMessage(chatKey(), CHAT, EPOCH, 'alice', 'привет', {
      fingerprint: alice.fingerprint,
      sign: (data) => signParts(alice.ecdsaPrivate, data),
    });
    const envelope = parseEnvelope(payload)!;

    expect(envelope.kid).toBe(alice.fingerprint);
    expect(
      await verifyParts(
        alice.ecdsa,
        {
          chatId: CHAT,
          epoch: EPOCH,
          senderId: 'alice',
          iv: envelope.iv,
          data: envelope.data,
        },
        envelope.sig!
      )
    ).toBe(true);
  });
});
