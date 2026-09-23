import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/shared/api';
import { readBackupState } from './backupStatus';
import { ChatKeyManager } from './chatKeys';
import { bytesToBase64 } from './encoding';
import { loadIdentity, loadOrCreateIdentity, type ILocalIdentity } from './identity';
import { type IArgon2Params } from './keyBackup';
import { KeyBackupManager, WrongCloudPasswordError } from './keyBackupManager';
import { useMemoryKeyStore, writeKey } from './keyStore';

/**
 * Сценарии резервной копии целиком: настоящая криптография, настоящий
 * ChatKeyManager и сервер в памяти. «Устройство» — отдельное хранилище
 * ключей и свои экземпляры менеджеров; сервер у устройств общий.
 */

const FAST_ARGON2: IArgon2Params = { m: 256, t: 1, p: 1 };
const ACCOUNT = 'account-1';
const PEER = 'peer-1';
const CHAT = 'chat-1';

interface IServerBackupRow {
  version: number;
  formatVersion: number;
  identity: string;
  slots: unknown[];
}

interface IChatKeyRow {
  userId: string;
  encryptedKey: string;
  senderKeyId?: string;
  keyEpoch: number;
}

class FakeServer {
  backup: IServerBackupRow | null = null;

  backupChatKeys = new Map<string, { chatId: string; epoch: number; encryptedKey: string }>();

  publicKeys = new Map<string, string>();

  chatKeys = new Map<string, IChatKeyRow>();

  client(userId: string): ApiClient {
    const notFound = () => Object.assign(new Error('not found'), { status: 404 });

    const get = async (url: string, params: Record<string, unknown> = {}) => {
      if (url === '/encryption/backup') {
        if (!this.backup) throw notFound();
        return { data: structuredClone(this.backup) };
      }
      if (url === '/encryption/backup/chat-keys') {
        const keys = [...this.backupChatKeys.values()].filter(
          (row) => !params.chatId || row.chatId === params.chatId
        );
        return { data: { keys, next: '' } };
      }
      if (url.startsWith('/encryption/keys/')) {
        const publicKey = this.publicKeys.get(url.slice('/encryption/keys/'.length));
        if (!publicKey) throw notFound();
        return { data: { publicKey } };
      }
      if (url.startsWith('/encryption/my-key/')) {
        const row = this.chatKeys.get(userId);
        if (!row) throw notFound();
        return { data: row };
      }
      if (url.startsWith('/encryption/chat-keys/')) {
        return { data: { keys: [...this.chatKeys.values()] } };
      }
      throw notFound();
    };

    const put = async (url: string, body: IServerBackupRow & { expectedVersion: number }) => {
      if (url !== '/encryption/backup') throw notFound();

      const current = this.backup?.version ?? 0;
      if (body.expectedVersion !== current)
        throw Object.assign(new Error('conflict'), { status: 409 });

      const { expectedVersion: _ignored, ...rest } = body;
      this.backup = { ...rest, version: current + 1 };
      return { data: { version: current + 1 } };
    };

    const post = async (url: string, body: Record<string, unknown>) => {
      if (url === '/encryption/backup/chat-keys') {
        for (const row of body.keys as { chatId: string; epoch: number; encryptedKey: string }[]) {
          const key = `${row.chatId}:${row.epoch}`;
          if (!this.backupChatKeys.has(key)) this.backupChatKeys.set(key, row);
        }
        return { data: { stored: 0 } };
      }
      if (url === '/encryption/keys') {
        this.publicKeys.set(userId, body.publicKey as string);
        return { data: { ok: true } };
      }
      if (url.startsWith('/encryption/chat-keys/') || url.startsWith('/encryption/rotate-key/')) {
        for (const row of body.encryptedKeys as IChatKeyRow[]) {
          this.chatKeys.set(row.userId, { ...row, keyEpoch: body.keyEpoch as number });
        }
        return { data: { ok: true } };
      }
      return { data: { ok: true } };
    };

    const remove = async (url: string) => {
      if (url === '/encryption/backup') {
        this.backup = null;
        this.backupChatKeys.clear();
      }
      return { data: null };
    };

    return { get, put, post, delete: remove } as unknown as ApiClient;
  }
}

/* Имя с префиксом use — наследие хранилища, а не хук React: линтеру его
   надо показать под другим именем. */
const freshKeyStore = useMemoryKeyStore;

/** Одно устройство: своё хранилище ключей, свои менеджеры. */
function device(server: FakeServer, userId = ACCOUNT) {
  freshKeyStore();

  let identity: ILocalIdentity | null = null;
  const apiClient = server.client(userId);

  const chatKeys: ChatKeyManager = new ChatKeyManager({
    apiClient,
    identity: async () => {
      if (!identity) throw new Error('личность не установлена');
      return identity;
    },
    members: async () => [ACCOUNT, PEER],
    backup: {
      save: (chatId, chatKey) => backup.saveChatKey(chatId, chatKey),
      load: (chatId) => backup.loadChatKeys(chatId),
    },
  });

  const backup: KeyBackupManager = new KeyBackupManager({
    apiClient,
    chatKeys: () => chatKeys,
    onIdentity: (next) => {
      identity = next;
      void apiClient.post('/encryption/keys', { publicKey: next.bundle, keyId: next.fingerprint });
    },
    argon2: FAST_ARGON2,
  });

  return { backup, chatKeys, identity: () => identity };
}

const keyText = (key: Uint8Array | undefined) => (key ? bytesToBase64(key) : null);

describe('резервная копия: новый аккаунт', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer();
  });

  it('не создаёт личность молча, а просит задать облачный пароль', async () => {
    const first = device(server);

    expect(await first.backup.resolve(ACCOUNT)).toBeNull();
    expect(readBackupState()).toMatchObject({ status: 'needsSetup', migrating: false });
    expect(await loadIdentity(ACCOUNT)).toBeNull();
  });

  it('после пароля кладёт на сервер копию, которую сервер не может прочитать', async () => {
    const first = device(server);
    await first.backup.resolve(ACCOUNT);

    const identity = await first.backup.setup(ACCOUNT, 'облачный пароль длинный');

    expect(readBackupState().status).toBe('ready');
    expect(server.backup?.slots).toHaveLength(1);
    expect(JSON.stringify(server.backup)).not.toContain('облачный');
    expect(JSON.stringify(server.backup)).not.toContain(identity.bundle);
  });
});

describe('резервная копия: второе устройство', () => {
  let server: FakeServer;

  beforeEach(async () => {
    server = new FakeServer();
    const first = device(server);
    await first.backup.resolve(ACCOUNT);
    await first.backup.setup(ACCOUNT, 'облачный пароль длинный');
  });

  it('видит копию и просит её открыть', async () => {
    const second = device(server);

    expect(await second.backup.resolve(ACCOUNT)).toBeNull();
    expect(readBackupState().status).toBe('locked');
  });

  it('не открывает копию неверным паролем', async () => {
    const second = device(server);
    await second.backup.resolve(ACCOUNT);

    await expect(second.backup.unlockWithPassword(ACCOUNT, 'не тот пароль')).rejects.toBeInstanceOf(
      WrongCloudPasswordError
    );
    expect(await loadIdentity(ACCOUNT)).toBeNull();
  });

  it('получает ту же личность, а публикация связки её не меняет', async () => {
    const publishedBefore = server.publicKeys.get(ACCOUNT);
    const second = device(server);
    await second.backup.resolve(ACCOUNT);

    const identity = await second.backup.unlockWithPassword(ACCOUNT, 'облачный пароль длинный');

    expect(identity.bundle).toBe(publishedBefore);
    expect(server.publicKeys.get(ACCOUNT)).toBe(publishedBefore);
    expect(readBackupState().status).toBe('ready');
  });

  it('читает историю: ключи прошлых эпох приходят из копии', async () => {
    // Первое устройство переписывалось в двух эпохах.
    server = new FakeServer();
    const first = device(server);
    await first.backup.resolve(ACCOUNT);
    await first.backup.setup(ACCOUNT, 'облачный пароль длинный');
    const epochOne = await first.chatKeys.ensure(CHAT);
    const epochTwo = await first.chatKeys.rotate(CHAT);
    await first.backup.flush();
    expect(server.backupChatKeys.size).toBe(2);

    const second = device(server);
    await second.backup.resolve(ACCOUNT);
    await second.backup.unlockWithPassword(ACCOUNT, 'облачный пароль длинный');

    expect(keyText((await second.chatKeys.forEpoch(CHAT, 1))?.key)).toBe(
      keyText(epochOne.chatKey?.key)
    );
    expect(keyText((await second.chatKeys.forEpoch(CHAT, 2))?.key)).toBe(
      keyText(epochTwo.chatKey?.key)
    );
  });

  it('открывается мастер-ключом, переданным по QR', async () => {
    server = new FakeServer();
    const first = device(server);
    await first.backup.resolve(ACCOUNT);
    const original = await first.backup.setup(ACCOUNT, 'облачный пароль длинный');
    const master = first.backup.currentMasterKey();

    const second = device(server);
    await second.backup.resolve(ACCOUNT);
    const identity = await second.backup.unlockWithMasterKey(
      ACCOUNT,
      master as Uint8Array<ArrayBuffer>
    );

    expect(identity.bundle).toBe(original.bundle);
  });
});

describe('резервная копия: ключи чатов', () => {
  it('не заводит новую эпоху, если ключ текущей есть в копии', async () => {
    const server = new FakeServer();
    const first = device(server);
    await first.backup.resolve(ACCOUNT);
    await first.backup.setup(ACCOUNT, 'облачный пароль длинный');
    const created = await first.chatKeys.ensure(CHAT);
    await first.backup.flush();
    // Своей строки на сервере нет — например, её затёр прежний клиент.
    server.chatKeys.delete(ACCOUNT);

    const second = device(server);
    await second.backup.resolve(ACCOUNT);
    await second.backup.unlockWithMasterKey(
      ACCOUNT,
      first.backup.currentMasterKey() as Uint8Array<ArrayBuffer>
    );
    const ensured = await second.chatKeys.ensure(CHAT);

    expect(ensured.chatKey?.epoch).toBe(created.chatKey?.epoch);
    expect(keyText(ensured.chatKey?.key)).toBe(keyText(created.chatKey?.key));
  });

  it('при промахе на готовом устройстве берёт эпоху из копии', async () => {
    const server = new FakeServer();
    const first = device(server);
    await first.backup.resolve(ACCOUNT);
    await first.backup.setup(ACCOUNT, 'облачный пароль длинный');
    const created = await first.chatKeys.ensure(CHAT);
    await first.backup.flush();

    // Второе устройство открыло копию, когда ключа там ещё не было, а своей
    // строки на сервере у него нет: остаётся только копия.
    const saved = new Map(server.backupChatKeys);
    server.backupChatKeys.clear();
    const second = device(server);
    await second.backup.resolve(ACCOUNT);
    await second.backup.unlockWithMasterKey(
      ACCOUNT,
      first.backup.currentMasterKey() as Uint8Array<ArrayBuffer>
    );
    server.backupChatKeys = saved;
    server.chatKeys.delete(ACCOUNT);

    const found = await second.chatKeys.forEpoch(CHAT, created.chatKey?.epoch as number);

    expect(keyText(found?.key)).toBe(keyText(created.chatKey?.key));
  });
});

describe('резервная копия: смена пароля и сброс', () => {
  let server: FakeServer;
  let first: ReturnType<typeof device>;

  beforeEach(async () => {
    server = new FakeServer();
    first = device(server);
    await first.backup.resolve(ACCOUNT);
    await first.backup.setup(ACCOUNT, 'облачный пароль длинный');
  });

  it('после смены пароля копия открывается новым и не открывается старым', async () => {
    await first.backup.changePassword('новый облачный пароль');

    const second = device(server);
    await second.backup.resolve(ACCOUNT);

    await expect(
      second.backup.unlockWithPassword(ACCOUNT, 'облачный пароль длинный')
    ).rejects.toBeInstanceOf(WrongCloudPasswordError);
    await expect(
      second.backup.unlockWithPassword(ACCOUNT, 'новый облачный пароль')
    ).resolves.toBeTruthy();
  });

  it('устройство со старым мастер-ключом после сброса на другом устройстве закрывается', async () => {
    const second = device(server);
    await second.backup.resolve(ACCOUNT);
    await second.backup.reset(ACCOUNT);
    expect(readBackupState().status).toBe('needsSetup');
    await second.backup.setup(ACCOUNT, 'пароль после сброса');

    // Устройство, у которого остался мастер-ключ сброшенной копии.
    const stale = new KeyBackupManager({
      apiClient: server.client(ACCOUNT),
      chatKeys: () => first.chatKeys,
      onIdentity: () => {},
      argon2: FAST_ARGON2,
    });
    await writeKey(
      `backupkey:${ACCOUNT}`,
      bytesToBase64(first.backup.currentMasterKey() as Uint8Array<ArrayBuffer>)
    );

    expect(await stale.resolve(ACCOUNT)).toBeNull();
    expect(readBackupState().status).toBe('locked');
  });
});

describe('резервная копия: переход с прежней схемы (#747)', () => {
  it('уносит в копию переписку прежней личности и перезаворачивает себе ключи', async () => {
    const server = new FakeServer();
    const old = device(server);
    // Устройство прежней схемы: личность без копии и ключ чата на месте.
    const legacy = await loadOrCreateIdentity(ACCOUNT);
    await writeKey(`chatkey:${ACCOUNT}:${CHAT}:1`, bytesToBase64(new Uint8Array(32).fill(7)));
    await writeKey(`chatkey-latest:${ACCOUNT}:${CHAT}`, 1);

    expect(await old.backup.resolve(ACCOUNT)).toBeNull();
    expect(readBackupState()).toMatchObject({ status: 'needsSetup', migrating: true });

    const identity = await old.backup.setup(ACCOUNT, 'облачный пароль длинный');

    expect(identity.bundle).not.toBe(legacy.bundle);
    expect(server.backupChatKeys.has(`${CHAT}:1`)).toBe(true);
    expect(server.chatKeys.get(ACCOUNT)?.keyEpoch).toBe(1);

    const fresh = device(server);
    await fresh.backup.resolve(ACCOUNT);
    await fresh.backup.unlockWithPassword(ACCOUNT, 'облачный пароль длинный');

    expect(keyText((await fresh.chatKeys.forEpoch(CHAT, 1))?.key)).toBe(
      bytesToBase64(new Uint8Array(32).fill(7))
    );
  });
});
