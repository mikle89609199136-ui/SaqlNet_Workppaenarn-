import type { ApiClient } from '@/shared/api';

// In-memory transport for real WebCrypto/backup integration tests.
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

export class BackupTestServer {
  backup: IServerBackupRow | null = null;

  backupChatKeys = new Map<string, { chatId: string; epoch: number; encryptedKey: string }>();

  publicKeys = new Map<string, string>();

  chatKeys = new Map<string, IChatKeyRow>();

  private rowId(chatId: string, userId: string): string {
    return chatId === 'chat-1' ? userId : `${chatId}:${userId}`;
  }

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
        const chatId = url.slice('/encryption/my-key/'.length);
        const row = this.chatKeys.get(this.rowId(chatId, userId));
        if (!row) throw notFound();
        return { data: row };
      }
      if (url.startsWith('/encryption/chat-keys/')) {
        const chatId = url.slice('/encryption/chat-keys/'.length);
        const keys = [...this.chatKeys.entries()]
          .filter(([id, row]) => id === this.rowId(chatId, row.userId))
          .map(([, row]) => row);
        return { data: { keys, keyEpoch: Math.max(0, ...keys.map((row) => row.keyEpoch)) } };
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
          const chatId = url.split('/').at(-1)!;
          this.chatKeys.set(this.rowId(chatId, row.userId), {
            ...row,
            keyEpoch: body.keyEpoch as number,
          });
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
