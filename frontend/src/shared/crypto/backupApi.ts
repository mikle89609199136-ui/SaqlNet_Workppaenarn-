import { API_ENDPOINTS, type ApiClient } from '@/shared/api';
import { isBackupSlot, type TBackupSlot } from './keyBackup';

/**
 * Резервная копия на сервере (#740).
 *
 * Сервер хранит непрозрачные блобы: всё, что сюда уходит, зашифровано на
 * устройстве. Ответы разбираются строго — копия приходит с сервера и
 * попадает прямо в криптографию.
 */

export interface IServerBackup {
  version: number;
  formatVersion: number;
  identity: string;
  slots: TBackupSlot[];
}

export interface IBackupChatKeyRow {
  chatId: string;
  epoch: number;
  encryptedKey: string;
}

/** Копию изменило другое устройство, пока мы её правили. */
export class BackupVersionConflictError extends Error {
  constructor() {
    super('Резервную копию изменило другое устройство');
    this.name = 'BackupVersionConflictError';
  }
}

const statusOf = (error: unknown) => (error as { status?: number } | null)?.status;

function parseBackup(data: unknown): IServerBackup {
  const candidate = data as Partial<IServerBackup> | null;

  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.version !== 'number' ||
    typeof candidate.formatVersion !== 'number' ||
    typeof candidate.identity !== 'string' ||
    !Array.isArray(candidate.slots)
  ) {
    throw new Error('Сервер вернул повреждённую резервную копию');
  }

  return { ...candidate, slots: candidate.slots.filter(isBackupSlot) } as IServerBackup;
}

/** `null` — копии нет. */
export async function fetchBackup(apiClient: ApiClient): Promise<IServerBackup | null> {
  try {
    const response = await apiClient.get<unknown>(API_ENDPOINTS.ENCRYPTION_BACKUP);
    return parseBackup(response.data);
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

/** Возвращает новую версию. `expectedVersion: 0` — создание. */
export async function saveBackup(
  apiClient: ApiClient,
  backup: Omit<IServerBackup, 'version'> & { expectedVersion: number }
): Promise<number> {
  try {
    const response = await apiClient.put<{ version: number }>(
      API_ENDPOINTS.ENCRYPTION_BACKUP,
      backup
    );
    return response.data.version;
  } catch (error) {
    if (statusOf(error) === 409) throw new BackupVersionConflictError();
    throw error;
  }
}

export async function deleteBackup(apiClient: ApiClient): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.ENCRYPTION_BACKUP);
}

const CHAT_KEYS_BATCH = 500;

export async function uploadBackupChatKeys(
  apiClient: ApiClient,
  rows: IBackupChatKeyRow[]
): Promise<void> {
  for (let start = 0; start < rows.length; start += CHAT_KEYS_BATCH) {
    await apiClient.post(API_ENDPOINTS.ENCRYPTION_BACKUP_CHAT_KEYS, {
      keys: rows.slice(start, start + CHAT_KEYS_BATCH),
    });
  }
}

/** Все ключи копии, страница за страницей. `chatId` — только одного чата. */
export async function fetchBackupChatKeys(
  apiClient: ApiClient,
  chatId?: string
): Promise<IBackupChatKeyRow[]> {
  const rows: IBackupChatKeyRow[] = [];
  let after = '';

  do {
    const response = await apiClient.get<{ keys?: IBackupChatKeyRow[]; next?: string }>(
      API_ENDPOINTS.ENCRYPTION_BACKUP_CHAT_KEYS,
      { limit: 1000, ...(chatId ? { chatId } : {}), ...(after ? { after } : {}) }
    );

    for (const row of response.data.keys ?? []) {
      if (
        typeof row?.chatId === 'string' &&
        typeof row.epoch === 'number' &&
        typeof row.encryptedKey === 'string'
      ) {
        rows.push(row);
      }
    }

    after = response.data.next ?? '';
  } while (after);

  return rows;
}
