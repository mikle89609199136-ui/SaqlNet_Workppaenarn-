import type { ApiClient } from '@/shared/api';
import {
  BackupVersionConflictError,
  deleteBackup,
  fetchBackup,
  fetchBackupChatKeys,
  saveBackup,
  uploadBackupChatKeys,
  type IBackupChatKeyRow,
  type IServerBackup,
} from './backupApi';
import { setBackupState, type IBackupState } from './backupStatus';
import type { ChatKeyManager, IChatKey } from './chatKeys';
import { base64ToBytes, bytesToBase64 } from './encoding';
import {
  createPortableIdentity,
  loadIdentity,
  restorePortableIdentity,
  type ILocalIdentity,
} from './identity';
import {
  BACKUP_FORMAT_VERSION,
  createPasswordSlot,
  generateMasterKey,
  openChatKey,
  openIdentity,
  openPasswordSlot,
  openPasskeySlot,
  sealChatKey,
  sealIdentity,
  type IArgon2Params,
  type IPasskeySlot,
  type IPasswordSlot,
  type IPortableIdentity,
  type TBackupSlot,
} from './keyBackup';
import { readKey, removeKey, removeKeysWithPrefix, writeKey } from './keyStore';

/**
 * Резервная копия ключей на этом устройстве (#742, #743, #747).
 *
 * Решает, в каком состоянии устройство, и переводит его между состояниями:
 *
 * | На устройстве            | Копия на сервере      | Состояние                     |
 * |--------------------------|-----------------------|-------------------------------|
 * | мастер-ключ открывает её | есть                  | `ready`                       |
 * | мастер-ключа нет или он  | есть                  | `locked` — открыть паролем,   |
 * | от сброшенной копии      |                       | passkey или по QR             |
 * | личность прежней схемы   | нет                   | `needsSetup`, `migrating`     |
 * | ничего                   | нет                   | `needsSetup`                  |
 *
 * Главное правило: **личность больше не создаётся молча**. Если копия
 * есть, новая личность на новом устройстве отрезала бы его от истории, а
 * собеседникам показала бы «сменил ключи».
 */

export interface IKeyBackupManagerDeps {
  apiClient: ApiClient;
  chatKeys: () => ChatKeyManager;
  /**
   * Личность установлена. Вызывается до работы с ключами чатов: им нужна
   * личность, и узнать о ней после возврата из метода было бы поздно.
   */
  onIdentity: (identity: ILocalIdentity) => void;
  /** Параметры Argon2 для новых слотов; тестам нужны дешёвые. */
  argon2?: IArgon2Params;
}

/** Облачный пароль не подошёл ни к одному слоту. */
export class WrongCloudPasswordError extends Error {
  constructor() {
    super('Неверный облачный пароль');
    this.name = 'WrongCloudPasswordError';
  }
}

const UPLOAD_DELAY_MS = 1000;
const UPLOAD_RETRY_MS = 30 * 1000;

const masterKeyStorage = (accountId: string) => `backupkey:${accountId}`;
const sealedIdentityStorage = (accountId: string) => `backupidentity:${accountId}`;
const backedUpPrefix = (accountId: string) => `chatkey-backed:${accountId}:`;
const backedUpStorage = (accountId: string, chatId: string, epoch: number) =>
  `${backedUpPrefix(accountId)}${chatId}:${epoch}`;

const passwordSlots = (slots: TBackupSlot[]) =>
  slots.filter((slot): slot is IPasswordSlot => slot.type === 'password');

export const passkeySlots = (slots: TBackupSlot[]) =>
  slots.filter((slot): slot is IPasskeySlot => slot.type === 'passkey');

export class KeyBackupManager {
  private deps: IKeyBackupManagerDeps;

  private accountId: string | null = null;

  private masterKey: Uint8Array | null = null;

  private pending = new Map<string, IChatKey & { chatId: string }>();

  private uploadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: IKeyBackupManagerDeps) {
    this.deps = deps;
  }

  private publish(state: Partial<IBackupState> & Pick<IBackupState, 'status'>): void {
    setBackupState({ hasPasskey: false, migrating: false, ...state });
  }

  private async rememberMasterKey(accountId: string, master: Uint8Array, sealed: string) {
    await writeKey(masterKeyStorage(accountId), bytesToBase64(master));
    await writeKey(sealedIdentityStorage(accountId), sealed);
    this.accountId = accountId;
    this.masterKey = master;
  }

  /**
   * Состояние устройства. Возвращает личность, если переписка готова к
   * работе, и `null`, если человеку нужно что-то сделать.
   */
  async resolve(accountId: string): Promise<ILocalIdentity | null> {
    this.accountId = accountId;

    const local = await loadIdentity(accountId);
    const storedMaster = await readKey<string>(masterKeyStorage(accountId));
    const master = storedMaster ? base64ToBytes(storedMaster) : null;

    let server: IServerBackup | null;
    try {
      server = await fetchBackup(this.deps.apiClient);
    } catch (error) {
      // Сети нет — работаем с тем, что есть: копию сверим в следующий раз.
      if (local && master) {
        this.masterKey = master;
        this.deps.onIdentity(local);
        this.publish({ status: 'ready' });
        return local;
      }
      throw error;
    }

    if (server) {
      const hasPasskey = passkeySlots(server.slots).length > 0;

      if (master) {
        try {
          const portable = await openIdentity(master, accountId, server.identity);
          const identity =
            local?.bundle === portable.bundle
              ? local
              : await restorePortableIdentity(accountId, portable);

          this.masterKey = master;
          this.deps.onIdentity(identity);
          this.publish({ status: 'ready', hasPasskey });
          void this.backUpLocalKeys();

          return identity;
        } catch {
          // Мастер-ключ от прежней копии: её сбросили на другом устройстве.
        }
      }

      this.masterKey = null;
      this.publish({ status: 'locked', hasPasskey });
      return null;
    }

    this.masterKey = null;
    this.publish({ status: 'needsSetup', migrating: Boolean(local) && !master });
    return null;
  }

  /**
   * Первая настройка: облачный пароль и копия.
   *
   * Если копия потерялась, а мастер-ключ и запечатанная личность остались
   * на устройстве, — копия собирается из них заново, личность та же.
   * Если на устройстве личность прежней схемы (#747), её вынести нельзя:
   * создаётся новая, а переписка уходит в копию ключами чатов.
   */
  async setup(accountId: string, password: string): Promise<ILocalIdentity> {
    const storedMaster = await readKey<string>(masterKeyStorage(accountId));
    const storedSealed = await readKey<string>(sealedIdentityStorage(accountId));
    const previous = await loadIdentity(accountId);

    let master: Uint8Array;
    let sealed: string;
    let portable: IPortableIdentity | null = null;

    if (storedMaster && storedSealed) {
      master = base64ToBytes(storedMaster);
      sealed = storedSealed;
    } else {
      master = generateMasterKey();
      portable = await createPortableIdentity();
      sealed = await sealIdentity(master, accountId, portable);
    }

    const slot = await createPasswordSlot(master, password, this.deps.argon2);

    try {
      await saveBackup(this.deps.apiClient, {
        expectedVersion: 0,
        formatVersion: BACKUP_FORMAT_VERSION,
        identity: sealed,
        slots: [slot],
      });
    } catch (error) {
      // Копию только что создало другое устройство — её надо открыть, а не
      // заводить вторую.
      if (error instanceof BackupVersionConflictError) await this.resolve(accountId);
      throw error;
    }

    const identity = portable
      ? await restorePortableIdentity(accountId, portable)
      : ((await loadIdentity(accountId)) ??
        (await restorePortableIdentity(accountId, await openIdentity(master, accountId, sealed))));

    await this.rememberMasterKey(accountId, master, sealed);
    this.deps.onIdentity(identity);
    this.publish({ status: 'ready' });

    await this.backUpLocalKeys();

    // Личность сменилась — свои строки ключей завёрнуты для прежней.
    if (previous && previous.bundle !== identity.bundle) {
      const chats = new Set(
        (await this.deps.chatKeys().listLocal(accountId)).map((row) => row.chatId)
      );
      for (const chatId of chats) {
        await this.deps
          .chatKeys()
          .rewrapForSelf(chatId)
          .catch(() => {});
      }
    }

    return identity;
  }

  /** Открыть копию облачным паролем. */
  async unlockWithPassword(accountId: string, password: string): Promise<ILocalIdentity> {
    const server = await fetchBackup(this.deps.apiClient);
    if (!server) throw new Error('Резервная копия не найдена');

    for (const slot of passwordSlots(server.slots)) {
      const master = await openPasswordSlot(slot, password);
      if (master) return this.unlock(accountId, master, server);
    }

    throw new WrongCloudPasswordError();
  }

  /**
   * Открыть копию секретом passkey. `evaluate` спрашивает аутентификатор по
   * слотам копии и возвращает, какой ключ ответил и его секрет.
   */
  async unlockWithPasskey(
    accountId: string,
    evaluate: (slots: IPasskeySlot[]) => Promise<{ credentialId: string; prfOutput: Uint8Array }>
  ): Promise<ILocalIdentity> {
    const server = await fetchBackup(this.deps.apiClient);
    if (!server) throw new Error('Резервная копия не найдена');

    const slots = passkeySlots(server.slots);
    const { credentialId, prfOutput } = await evaluate(slots);

    for (const slot of slots.filter((candidate) => candidate.credentialId === credentialId)) {
      const master = await openPasskeySlot(slot, prfOutput);
      if (master) return this.unlock(accountId, master, server);
    }

    throw new Error('Этот passkey не открывает резервную копию');
  }

  /** Открыть копию мастер-ключом, переданным с другого устройства по QR. */
  async unlockWithMasterKey(accountId: string, master: Uint8Array): Promise<ILocalIdentity> {
    const server = await fetchBackup(this.deps.apiClient);
    if (!server) throw new Error('Резервная копия не найдена');

    return this.unlock(accountId, master, server);
  }

  private async unlock(
    accountId: string,
    master: Uint8Array,
    server: IServerBackup
  ): Promise<ILocalIdentity> {
    const portable = await openIdentity(master, accountId, server.identity);
    const identity = await restorePortableIdentity(accountId, portable);

    await this.rememberMasterKey(accountId, master, server.identity);
    this.deps.onIdentity(identity);

    // Вся история — сразу: иначе каждое старое сообщение шло бы за своим
    // ключом отдельно.
    const byChat = new Map<string, IChatKey[]>();
    for (const row of await fetchBackupChatKeys(this.deps.apiClient)) {
      const chatKey = await this.openRow(master, row);
      if (!chatKey) continue;

      byChat.set(row.chatId, [...(byChat.get(row.chatId) ?? []), chatKey]);
      await writeKey(backedUpStorage(accountId, row.chatId, row.epoch), true);
    }
    for (const [chatId, keys] of byChat) await this.deps.chatKeys().importFromBackup(chatId, keys);

    this.publish({ status: 'ready', hasPasskey: passkeySlots(server.slots).length > 0 });

    // Переписка, накопленная на этом устройстве до копии, тоже уходит в неё.
    await this.backUpLocalKeys();

    return identity;
  }

  private async openRow(master: Uint8Array, row: IBackupChatKeyRow): Promise<IChatKey | null> {
    try {
      return {
        key: await openChatKey(master, row.chatId, row.epoch, row.encryptedKey),
        epoch: row.epoch,
      };
    } catch {
      // Запись не наша или повреждена — пропускаем, остальное читается.
      return null;
    }
  }

  /** Эпохи одного чата из копии — для `ChatKeyManager` при промахе. */
  async loadChatKeys(chatId: string): Promise<IChatKey[]> {
    const master = this.masterKey;
    if (!master) return [];

    const keys: IChatKey[] = [];
    for (const row of await fetchBackupChatKeys(this.deps.apiClient, chatId).catch(() => [])) {
      const chatKey = await this.openRow(master, row);
      if (chatKey) keys.push(chatKey);
    }

    return keys;
  }

  /** Положить ключ чата в копию. Очередь переживает сбои сети. */
  saveChatKey(chatId: string, chatKey: IChatKey): void {
    if (!this.masterKey) return;

    this.pending.set(`${chatId}:${chatKey.epoch}`, { ...chatKey, chatId });
    this.scheduleUpload(UPLOAD_DELAY_MS);
  }

  private scheduleUpload(delay: number): void {
    if (this.uploadTimer) return;

    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = null;
      void this.flush();
    }, delay);
  }

  /** Выгрузить очередь сейчас. */
  async flush(): Promise<void> {
    const master = this.masterKey;
    const accountId = this.accountId;
    if (!master || !accountId || this.pending.size === 0) return;

    const batch = [...this.pending.values()];

    try {
      const rows = await Promise.all(
        batch.map(async ({ chatId, epoch, key }) => ({
          chatId,
          epoch,
          encryptedKey: await sealChatKey(master, chatId, epoch, key),
        }))
      );

      await uploadBackupChatKeys(this.deps.apiClient, rows);

      for (const { chatId, epoch } of batch) {
        this.pending.delete(`${chatId}:${epoch}`);
        await writeKey(backedUpStorage(accountId, chatId, epoch), true);
      }
    } catch (error) {
      console.warn('Не удалось положить ключи в резервную копию, повторим позже', error);
      this.scheduleUpload(UPLOAD_RETRY_MS);
    }
  }

  /** Всё, что есть на устройстве и ещё не в копии, — в копию. */
  private async backUpLocalKeys(): Promise<void> {
    const accountId = this.accountId;
    if (!accountId || !this.masterKey) return;

    const chatKeys = this.deps.chatKeys();

    for (const { chatId, epoch } of await chatKeys.listLocal(accountId)) {
      if (await readKey<boolean>(backedUpStorage(accountId, chatId, epoch))) continue;

      const chatKey = await chatKeys.localKey(chatId, epoch);
      if (chatKey) this.pending.set(`${chatId}:${epoch}`, { ...chatKey, chatId });
    }

    await this.flush();
  }

  /** Мастер-ключ для передачи на новое устройство по QR. */
  currentMasterKey(): Uint8Array | null {
    return this.masterKey;
  }

  /**
   * Правка слотов копии: смена пароля, добавление и удаление passkey.
   *
   * Копию могло изменить другое устройство — тогда перечитываем и
   * применяем правку ещё раз.
   */
  private async editSlots(edit: (slots: TBackupSlot[]) => TBackupSlot[]): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const server = await fetchBackup(this.deps.apiClient);
      if (!server) throw new Error('Резервная копия не найдена');

      try {
        await saveBackup(this.deps.apiClient, {
          expectedVersion: server.version,
          formatVersion: server.formatVersion,
          identity: server.identity,
          slots: edit(server.slots),
        });

        this.publish({ status: 'ready', hasPasskey: passkeySlots(edit(server.slots)).length > 0 });
        return;
      } catch (error) {
        if (!(error instanceof BackupVersionConflictError)) throw error;
      }
    }

    throw new BackupVersionConflictError();
  }

  async changePassword(password: string): Promise<void> {
    const master = this.masterKey;
    if (!master) throw new Error('Резервная копия на этом устройстве не открыта');

    const slot = await createPasswordSlot(master, password, this.deps.argon2);

    await this.editSlots((slots) => [...slots.filter((item) => item.type !== 'password'), slot]);
  }

  async addPasskeySlot(slot: IPasskeySlot): Promise<void> {
    await this.editSlots((slots) => [
      ...slots.filter((item) => item.type !== 'passkey' || item.credentialId !== slot.credentialId),
      slot,
    ]);
  }

  async removePasskeySlots(): Promise<void> {
    await this.editSlots((slots) => slots.filter((item) => item.type !== 'passkey'));
  }

  /** Слоты копии — чтобы показать в настройках, какие способы входа есть. */
  async slots(): Promise<TBackupSlot[]> {
    return (await fetchBackup(this.deps.apiClient))?.slots ?? [];
  }

  /**
   * Сброс копии: пароль забыт, других устройств и passkey нет.
   *
   * Копия удаляется с сервера, с этого устройства — личность и мастер-ключ.
   * Ключи чатов на устройстве остаются: по ним здесь по-прежнему читается
   * то, что было, и при новой настройке они уйдут в новую копию.
   */
  async reset(accountId: string): Promise<void> {
    await deleteBackup(this.deps.apiClient);
    await this.forgetDevice(accountId);
    this.publish({ status: 'needsSetup' });
  }

  /**
   * Стереть с устройства личность и всё, что относится к копии. Ключи
   * чатов — забота `ChatKeyManager`: при сбросе копии они остаются.
   */
  async forgetDevice(accountId: string): Promise<void> {
    await removeKey(masterKeyStorage(accountId));
    await removeKey(sealedIdentityStorage(accountId));
    await removeKey(`identity:${accountId}`);
    await removeKeysWithPrefix(backedUpPrefix(accountId));

    this.forget();
  }

  /** Выход из аккаунта: память чистится, на устройстве всё остаётся. */
  forget(): void {
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    this.pending.clear();
    this.masterKey = null;
    this.accountId = null;
  }
}
