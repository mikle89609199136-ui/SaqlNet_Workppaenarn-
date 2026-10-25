import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { ApiClient } from '@/shared/api';
import { STORAGE_KEYS } from '@/shared/config';
import {
  encryptMessage,
  forgetPeerIdentities,
  loadOrCreateIdentity,
  signParts,
  parseEnvelope,
  removeKey,
  useMemoryKeyStore as freshKeyStore,
} from '@/shared/crypto';
import { setChatResolver, setMembersResolver } from '@/entities/chat/model/chatResolver';
import { chatKeys } from '@/entities/chat';
import { flattenThread, type IThreadPages } from '@/entities/message';
import { resyncAfterReconnect } from '@/realtime/resyncAfterReconnect';
import { services } from './serviceContainer';
import { makeMessage } from '@/test/fixtures';
import { BackupTestServer } from '@/test/fixtures/backupServer';
import type { IMessageDto } from '@/types';
import { CryptoService } from './CryptoService';
import { MessageService } from './MessageService';

// Real MessageService → CryptoService → backup/key managers → WebCrypto.
// Only the remote transport is replaced; stored messages are always wire DTOs.
const ACCOUNT = 'account-1';
const CHAT = 'chat-1';
const PASSWORD = 'separate cloud password for recovery';
const instances: CryptoService[] = [];

function transport() {
  const server = new BackupTestServer();
  const keys = server.client(ACCOUNT);
  const messages: IMessageDto[] = [];
  const apiClient = {
    ...keys,
    get: async (url: string, params?: Parameters<ApiClient['get']>[1]) => {
      if (url.startsWith('/messages/')) {
        const chatId = url.slice('/messages/'.length);
        const offset = Number(params?.offset ?? 0);
        const limit = Number(params?.limit ?? 50);
        return {
          data: {
            messages: structuredClone(
              messages
                .filter((m) => m.chatId === chatId)
                .slice()
                .reverse()
                .slice(offset, offset + limit)
            ),
          },
        };
      }
      return keys.get(url, params);
    },
    post: async (url: string, body: Record<string, unknown>) => {
      if (url.startsWith('/messages/')) {
        const batch = (body.messages as Partial<IMessageDto>[]).map((item) =>
          makeMessage({
            ...structuredClone(item),
            chatId: url.slice('/messages/'.length),
            senderId: ACCOUNT,
          })
        );
        messages.push(...batch);
        return { data: { messages: structuredClone(batch) } };
      }
      return keys.post(url, body);
    },
    put: async (url: string, body: Record<string, unknown>) => {
      if (url.startsWith('/messages/')) {
        const message = messages.find((m) => m.id === url.slice('/messages/'.length))!;
        Object.assign(message, structuredClone(body), { isEdited: true });
        return { data: structuredClone(message) };
      }
      return keys.put(url, body);
    },
  } as unknown as ApiClient;
  function device() {
    freshKeyStore();
    forgetPeerIdentities();
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: ACCOUNT }));
    const crypto = new CryptoService(apiClient, { argon2: { m: 256, t: 1, p: 1 } });
    instances.push(crypto);
    return { crypto, messages: new MessageService(apiClient, crypto) };
  }
  return { server, messages, device };
}

beforeEach(() => {
  setChatResolver(async (id) => ({ id, type: 'self' }) as never);
  setMembersResolver(async () => [{ id: ACCOUNT }] as never);
});
afterEach(() => {
  instances.splice(0).forEach((service) => service.forgetSession());
  setChatResolver(null);
  setMembersResolver(null);
});

describe('production E2E recovery contract (#707)', () => {
  it('reads v2/v3 history and encrypted media on a replacement device across epochs', async () => {
    const remote = transport();
    const first = remote.device();
    await first.crypto.setupBackup(PASSWORD);
    const fingerprint = await first.crypto.fingerprintOf(ACCOUNT);
    await first.messages.sendMessage(CHAT, 'before rotation');
    const media = await first.crypto.encryptMedia(
      CHAT,
      new Blob(['private bytes'], { type: 'text/plain' })
    );
    await first.crypto.rotateChatKey(CHAT);
    const entities = [{ type: 'bold' as const, offset: 0, length: 5 }];
    await first.messages.sendMessage(CHAT, 'after rotation', 'text', null, entities);
    await expect.poll(() => remote.server.backupChatKeys.size).toBe(2);
    const wire = structuredClone(remote.messages);
    expect(wire.map((m) => parseEnvelope(m.content)?.v)).toEqual([2, 3]);
    first.crypto.forgetSession();

    const replacement = remote.device();
    expect(await replacement.crypto.init()).toBeNull();
    expect(await replacement.crypto.decryptMessage(CHAT, wire[0].content, ACCOUNT)).toMatchObject({
      undecryptable: 'keyUnavailable',
    });
    await replacement.crypto.unlockWithPassword(PASSWORD);
    expect(await replacement.crypto.fingerprintOf(ACCOUNT)).toBe(fingerprint);
    const history = await replacement.messages.fetchMessagesPage(CHAT);
    expect(history.map((m) => m.content)).toEqual(['before rotation', 'after rotation']);
    expect(history[1].entities).toEqual(entities);
    expect(history.every((m) => !m.undecryptable)).toBe(true);
    expect(await (await replacement.crypto.decryptMedia(CHAT, media)).text()).toBe('private bytes');
    expect(remote.messages).toEqual(wire);
    expect(remote.server.publicKeys.get(ACCOUNT)).toBeTruthy();
  });

  it('encrypts replies, edits and forwards with the current destination epoch', async () => {
    const remote = transport();
    const device = remote.device();
    await device.crypto.setupBackup(PASSWORD);
    const original = await device.messages.sendMessage(CHAT, 'original');
    await device.crypto.rotateChatKey(CHAT);
    await device.messages.sendMessage(CHAT, 'reply', 'text', original.id);
    await device.messages.editMessage(original.id, CHAT, 'edited');
    const [edited] = await device.messages.fetchMessagesPage(CHAT);
    await device.messages.forwardMessages('destination', [edited]);
    const [source, reply, forwarded] = remote.messages;
    expect(parseEnvelope(source.content)?.epoch).toBe(2);
    expect(parseEnvelope(reply.content)?.epoch).toBe(2);
    expect(reply.replyTo).toBe(original.id);
    expect(parseEnvelope(forwarded.content)?.epoch).toBe(1);
    expect(forwarded).toMatchObject({ forwardedFrom: original.id });
    expect(forwarded.content).not.toBe(source.content);
    expect(
      await device.crypto.decryptMessage('destination', forwarded.content, ACCOUNT)
    ).toMatchObject({ text: 'edited' });
    expect(await device.crypto.decryptMessage(CHAT, forwarded.content, ACCOUNT)).toMatchObject({
      undecryptable: 'keyUnavailable',
    });
    expect(JSON.stringify(remote.messages)).not.toContain('edited');
  });

  it('recovers missed ciphertext and a missed rotation through the actual reconnect flow', async () => {
    const remote = transport();
    const device = remote.device();
    await device.crypto.setupBackup(PASSWORD);
    const before = await device.messages.sendMessage(CHAT, 'before disconnect');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<IThreadPages>(chatKeys.messages(CHAT), {
      pages: [[before]],
      pageParams: [0],
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: chatKeys.messages(CHAT),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    vi.spyOn(services.messageService, 'fetchMessagesPage').mockImplementation((...args) =>
      device.messages.fetchMessagesPage(...args)
    );
    try {
      await device.crypto.rotateChatKey(CHAT);
      await device.messages.sendMessage(CHAT, 'missed encrypted event');
      await device.messages.editMessage(before.id, CHAT, 'edited while offline');
      await expect.poll(() => remote.server.backupChatKeys.size).toBe(2);
      device.crypto.forgetSession();
      // The receiving tab missed the key event and has no epoch-2 key.
      await removeKey(`chatkey:${ACCOUNT}:${CHAT}:2`);
      // The new epoch has not reached the backup either: use the wrapped row.
      remote.server.backupChatKeys.delete(`${CHAT}:2`);
      await device.crypto.init();
      await resyncAfterReconnect(queryClient);
      await resyncAfterReconnect(queryClient);
      const recovered = flattenThread(
        queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT))
      );
      expect(recovered.map((m) => m.content)).toEqual([
        'edited while offline',
        'missed encrypted event',
      ]);
      expect(new Set(recovered.map((m) => m.id)).size).toBe(2);
      expect(recovered.every((m) => !m.undecryptable)).toBe(true);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  it('fails closed for changed AEAD context, corrupt media and unsupported versions', async () => {
    const remote = transport();
    const device = remote.device();
    await device.crypto.setupBackup(PASSWORD);
    const content = await device.crypto.encryptMessage(CHAT, 'private text');
    const envelope = parseEnvelope(content)!;
    for (const [chatId, senderId, wire] of [
      ['other-chat', ACCOUNT, content],
      [CHAT, 'other-sender', content],
      [CHAT, ACCOUNT, JSON.stringify({ ...envelope, epoch: envelope.epoch + 1 })],
      [CHAT, ACCOUNT, JSON.stringify({ ...envelope, data: 'AAAA' })],
    ]) {
      expect(await device.crypto.decryptMessage(chatId, wire, senderId)).toMatchObject({
        undecryptable: 'keyUnavailable',
      });
    }
    for (const legacy of [
      '[MLS]dGV4dA==',
      JSON.stringify({ ...envelope, v: 1 }),
      JSON.stringify({ ...envelope, v: 99 }),
    ]) {
      expect(await device.crypto.decryptMessage(CHAT, legacy, ACCOUNT)).toMatchObject({
        undecryptable: 'legacy',
      });
    }
    const media = await device.crypto.encryptMedia(CHAT, new Blob(['private bytes']));
    await expect(
      device.crypto.decryptMedia(CHAT, { ...media, ciphertext: 'AAAA' })
    ).rejects.toThrow();
    await expect(device.crypto.decryptMedia('other-chat', media)).rejects.toThrow();
  });

  it('verifies peer signatures across identity replacement without trusting a claimed fingerprint', async () => {
    const remote = transport();
    const device = remote.device();
    await device.crypto.setupBackup(PASSWORD);
    const peer = await loadOrCreateIdentity('peer');
    remote.server.publicKeys.set('peer', peer.bundle);
    const { chatKey } = await device.crypto.ensureChatKey(CHAT);
    const content = await encryptMessage(
      chatKey!.key,
      CHAT,
      chatKey!.epoch,
      'peer',
      'signed by peer',
      {
        fingerprint: peer.fingerprint,
        sign: (parts) => signParts(peer.ecdsaPrivate, parts),
      }
    );
    expect(await device.crypto.decryptMessage(CHAT, content, 'peer')).toMatchObject({
      text: 'signed by peer',
      senderVerified: true,
    });
    // A replaced sender publishes a different identity. Old signatures still
    // verify against the recipient's remembered public bundle.
    const replacement = await loadOrCreateIdentity('replacement-peer-device');
    remote.server.publicKeys.set('peer', replacement.bundle);
    forgetPeerIdentities();
    expect(await device.crypto.decryptMessage(CHAT, content, 'peer')).toMatchObject({
      text: 'signed by peer',
      senderVerified: true,
    });
    const forged = JSON.stringify({
      ...parseEnvelope(content),
      kid: replacement.fingerprint,
      sig: 'AAAA',
    });
    expect(await device.crypto.decryptMessage(CHAT, forged, 'peer')).toMatchObject({
      text: 'signed by peer',
      senderVerified: false,
    });
  });
});
