import type { ApiClient } from '@/shared/api';
import { STORAGE_KEYS } from '@/shared/config';
import { resolveMembers } from '@/entities/chat/model/chatResolver';
import {
  ChatKeyManager,
  type IKeyDistribution,
  base64ToBytes,
  decryptMediaBytes,
  decryptMessage,
  encryptMediaBytes,
  encryptMessage,
  forgetDerivedKeys,
  isLegacyContent,
  parseEnvelope,
  fetchPeerIdentity,
  forgetBackupState,
  forgetPeerIdentities,
  KeyBackupManager,
  knownPeerIdentities,
  PEER_BUNDLES_PREFIX,
  publishIdentity,
  matchesLoginPassword,
  readBackupState,
  sealForQrReceiver,
  setBackupState,
  type IQrLink,
  type IQrPayload,
  type IArgon2Params,
  type ILocalIdentity,
  type IPasskeySlot,
  type TBackupSlot,
  removeKey,
  removeKeysWithPrefix,
  signParts,
  verifyParts,
  type ISignedParts,
} from '@/shared/crypto';
import type { IEncryptedMedia } from '@/shared/types';

/**
 * Шифрование чатов.
 *
 * Снаружи — четыре действия: зашифровать и расшифровать текст, зашифровать
 * и расшифровать файл. Внутри всё держится на ключе чата: он один на всех
 * участников, заворачивается для каждого отдельно и лежит на сервере
 * запечатанным. Сервер не может ни прочитать переписку, ни выдать себя за
 * собеседника — развернуть ключ можно только приватной частью личности,
 * а она никогда не покидает устройство.
 *
 * Личный чат и группа устроены одинаково. Каналы не шифруются вовсе, и в
 * интерфейсе это видно: обещать защиту тысяче читателей нечестно.
 */

/*
 * Тексты заглушек остаются здесь как запасные: показывать их должен тот,
 * кто рисует, — он знает язык. Сервису язык неизвестен, поэтому вместе с
 * текстом он возвращает причину (`undecryptable`), а интерфейс подставляет
 * перевод по ней.
 */
export const LEGACY_MESSAGE_PLACEHOLDER = '🔒 Сообщение в устаревшем формате';
export const KEY_UNAVAILABLE_PLACEHOLDER = '🔒 Ключ шифрования недоступен';
export const BEFORE_JOIN_PLACEHOLDER = '🔒 Сообщение написано до вашего появления в чате';
export const MEDIA_VERSION = 2;

const MEDIA_ALGORITHM = 'AES-GCM';

interface IMediaInput {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName?: string;
}

/**
 * Проверка того, что пришло вместе с файлом.
 *
 * Метаданные приходят с сервера и попадают прямо в криптографическую
 * операцию. Приведение типа здесь ничего не проверяет: недостающее поле
 * всплыло бы внутри расшифровки и выглядело бы как «файл не открылся».
 */
function isEncryptedMediaV2(payload: unknown): payload is IEncryptedMedia {
  if (typeof payload !== 'object' || payload === null) return false;

  const candidate = payload as Record<string, unknown>;

  return (
    candidate.encrypted === true &&
    candidate.version === MEDIA_VERSION &&
    candidate.algorithm === MEDIA_ALGORITHM &&
    typeof candidate.iv === 'string' &&
    typeof candidate.ciphertext === 'string'
  );
}

export type TUndecryptableReason = 'keyUnavailable' | 'beforeJoin' | 'legacy';

export interface IDecryptedMessage {
  text: string;
  /**
   * Почему сообщение не прочиталось. `undefined` — прочиталось.
   *
   * Раньше об этом говорил сам текст, и остальной код узнавал заглушку по
   * ведущему замку: `content.startsWith('🔒')`. Стоило перевести подпись —
   * и проверка переставала работать, а запрет пересылать нечитаемое
   * молча исчезал.
   */
  undecryptable?: TUndecryptableReason;
  /**
   * Удалось ли подтвердить, что сообщение написал тот, кто указан.
   *
   * `undefined` — вопрос не стоит: своё сообщение, обычный текст или
   * заглушка. `false` — подпись не сошлась ни с нынешней связкой
   * отправителя, ни с прежними, либо её нет вовсе.
   */
  senderVerified?: boolean;
}

export class CryptoService {
  private apiClient: ApiClient;

  private chatKeys: ChatKeyManager;

  private identity: ILocalIdentity | null = null;

  private initPromise: Promise<ILocalIdentity | null> | null = null;

  private backup: KeyBackupManager;

  /** Мастер-ключ, пришедший по QR до того, как сессия подготовлена. */
  private pendingMasterKey: Uint8Array<ArrayBuffer> | null = null;

  constructor(apiClient: ApiClient, options: { argon2?: IArgon2Params } = {}) {
    this.apiClient = apiClient;
    this.backup = new KeyBackupManager({
      apiClient,
      chatKeys: () => this.chatKeys,
      onIdentity: (identity) => {
        this.identity = identity;
      },
      argon2: options.argon2,
    });
    this.chatKeys = new ChatKeyManager({
      apiClient,
      identity: () => this.requireIdentity(),
      members: async (chatId) => (await resolveMembers(chatId)).map((member) => member.id),
      backup: {
        save: (chatId, chatKey) => this.backup.saveChatKey(chatId, chatKey),
        load: (chatId) => this.backup.loadChatKeys(chatId),
      },
    });
  }

  hasWebCrypto(): boolean {
    return Boolean(globalThis.crypto?.subtle);
  }

  getAccountId(): string | null {
    try {
      const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null');
      return user?.id || null;
    } catch {
      return null;
    }
  }

  /**
   * Подготовка личности.
   *
   * Личность одна на все устройства и приходит из резервной копии (#739).
   * Молча она больше не создаётся: на новом устройстве это отрезало бы его
   * от истории. `null` — нужно действие человека: задать облачный пароль
   * или открыть копию (`readBackupState` скажет, что именно).
   */
  async init(): Promise<ILocalIdentity | null> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<ILocalIdentity | null> {
    const accountId = this.getAccountId();
    if (!accountId) return null;

    if (!this.hasWebCrypto()) {
      setBackupState({ status: 'unavailable', hasPasskey: false, migrating: false });
      return null;
    }

    try {
      return await this.prepareIdentity(accountId);
    } catch (error) {
      setBackupState({ status: 'error', hasPasskey: false, migrating: false });
      throw error;
    }
  }

  private async prepareIdentity(accountId: string): Promise<ILocalIdentity | null> {
    if (this.identity?.accountId === accountId && readBackupState().status === 'ready') {
      return this.identity;
    }

    // Наследие прежней схемы: одиночная пара и заглушка группового
    // состояния. Ни то ни другое больше не читается.
    await removeKey(`signal_keypair:${accountId}`);
    await removeKeysWithPrefix(`mls_state:${accountId}`);

    let identity = await this.backup.resolve(accountId);

    const pending = this.pendingMasterKey;
    this.pendingMasterKey = null;
    if (!identity && pending && readBackupState().status === 'locked') {
      identity = await this.backup.unlockWithMasterKey(accountId, pending);
    }

    if (!identity) return null;

    return this.activate(identity);
  }

  /**
   * Личность готова к работе: публикуем связку.
   *
   * На всех устройствах связка одна и та же, поэтому публикация больше не
   * вытесняет соседнее устройство — сервер получает то, что у него уже есть.
   */
  private async activate(identity: ILocalIdentity): Promise<ILocalIdentity> {
    this.identity = identity;

    try {
      await publishIdentity(this.apiClient, identity);
    } catch (error) {
      // Без публикации собеседники не смогут завернуть ключ для нас.
      // Следующий вход попробует снова.
      console.warn('Не удалось опубликовать ключи шифрования', error);
    }

    return identity;
  }

  private async requireIdentity(): Promise<ILocalIdentity> {
    const identity = this.identity ?? (await this.init());

    if (!identity) {
      throw new Error(
        this.hasWebCrypto()
          ? 'Шифрование не готово: откройте резервную копию облачным паролем'
          : 'Шифрование недоступно: откройте приложение по HTTPS'
      );
    }

    return identity;
  }

  private requireAccountId(): string {
    const accountId = this.getAccountId();
    if (!accountId) throw new Error('Нет активной сессии');

    return accountId;
  }

  /** Первая настройка резервной копии облачным паролем. */
  async setupBackup(password: string): Promise<void> {
    this.chatKeys.forget();
    await this.activate(await this.backup.setup(this.requireAccountId(), password));
  }

  /** Открыть копию облачным паролем. Неверный пароль — `WrongCloudPasswordError`. */
  async unlockWithPassword(password: string): Promise<void> {
    this.chatKeys.forget();
    await this.activate(await this.backup.unlockWithPassword(this.requireAccountId(), password));
  }

  async unlockWithPasskey(
    evaluate: (
      slots: IPasskeySlot[]
    ) => Promise<{ credentialId: string; prfOutput: Uint8Array<ArrayBuffer> }>
  ): Promise<void> {
    this.chatKeys.forget();
    await this.activate(await this.backup.unlockWithPasskey(this.requireAccountId(), evaluate));
  }

  /**
   * Мастер-ключ, пришедший с другого устройства по QR.
   *
   * Сессия к этому моменту может быть ещё не сохранена — тогда ключ ждёт
   * ближайшей подготовки личности.
   */
  async acceptMasterKey(master: Uint8Array<ArrayBuffer>): Promise<void> {
    const accountId = this.getAccountId();

    if (!accountId || readBackupState().status !== 'locked') {
      this.pendingMasterKey = master;
      return;
    }

    this.chatKeys.forget();
    await this.activate(await this.backup.unlockWithMasterKey(accountId, master));
  }

  /** Мастер-ключ для передачи на новое устройство; `null` — копия здесь не открыта. */
  currentMasterKey(): Uint8Array<ArrayBuffer> | null {
    return this.backup.currentMasterKey();
  }

  /**
   * Мастер-ключ копии, зашифрованный для нового устройства из QR (#745).
   *
   * Интерфейсу сам ключ не нужен: он получает только шифровку.
   */
  async sealMasterKeyForLink(link: IQrLink): Promise<IQrPayload> {
    const master = this.backup.currentMasterKey();
    if (!master) throw new Error('Резервная копия на этом устройстве не открыта');

    return sealForQrReceiver(link, master);
  }

  /** Совпадает ли облачный пароль с паролем входа — его знает сервер. */
  isLoginPassword(password: string): Promise<boolean> {
    return matchesLoginPassword(password);
  }

  async changeCloudPassword(password: string): Promise<void> {
    await this.backup.changePassword(password);
  }

  async addPasskeySlot(slot: IPasskeySlot): Promise<void> {
    await this.backup.addPasskeySlot(slot);
  }

  async removePasskeySlots(): Promise<void> {
    await this.backup.removePasskeySlots();
  }

  async backupSlots(): Promise<TBackupSlot[]> {
    return this.backup.slots();
  }

  /**
   * Сброс копии, когда открыть её нечем. Переписка, которую держит только
   * копия, пропадает для всех устройств — спрашивать об этом должен экран.
   */
  async resetBackup(): Promise<void> {
    await this.backup.reset(this.requireAccountId());
    this.identity = null;
    this.chatKeys.forget();
  }

  async ensureChatKey(chatId: string): Promise<IKeyDistribution> {
    await this.requireIdentity();
    return this.chatKeys.ensure(chatId);
  }

  async rotateChatKey(chatId: string): Promise<IKeyDistribution> {
    await this.requireIdentity();
    return this.chatKeys.rotate(chatId);
  }

  async healChatKeys(chatId: string): Promise<IKeyDistribution> {
    await this.requireIdentity();
    return this.chatKeys.heal(chatId);
  }

  async encryptMessage(chatId: string, text: string): Promise<string> {
    if (!text) return text;

    if (!this.hasWebCrypto()) {
      throw new Error('Шифрование недоступно: откройте приложение по HTTPS');
    }

    const identity = await this.requireIdentity();
    const { chatKey } = await this.ensureChatKey(chatId);

    if (!chatKey) {
      throw new Error('Ключ шифрования чата недоступен — сообщение не отправлено');
    }

    return encryptMessage(chatKey.key, chatId, chatKey.epoch, identity.accountId, text, {
      fingerprint: identity.fingerprint,
      sign: (parts) => signParts(identity.ecdsaPrivate, parts),
    });
  }

  /**
   * Проверка подписи.
   *
   * Сначала — нынешняя связка отправителя, потом прежние: человек мог
   * сменить устройство после того, как отправил сообщение, и по нынешнему
   * ключу его собственное сообщение выглядело бы поддельным.
   */
  private async isSenderConfirmed(parts: ISignedParts, signature: string): Promise<boolean> {
    const current = await fetchPeerIdentity(this.apiClient, parts.senderId);
    if (current && (await verifyParts(current.ecdsa, parts, signature))) return true;

    for (const known of await knownPeerIdentities(parts.senderId)) {
      if (await verifyParts(known.ecdsa, parts, signature)) return true;
    }

    return false;
  }

  async decryptMessage(
    chatId: string,
    content: string,
    senderId: string
  ): Promise<IDecryptedMessage> {
    if (!content) return { text: content };
    if (!this.hasWebCrypto())
      return { text: KEY_UNAVAILABLE_PLACEHOLDER, undecryptable: 'keyUnavailable' };

    const envelope = parseEnvelope(content);

    if (!envelope) {
      return isLegacyContent(content)
        ? { text: LEGACY_MESSAGE_PLACEHOLDER, undecryptable: 'legacy' }
        : { text: content };
    }

    try {
      const identity = await this.requireIdentity();
      const chatKey = await this.chatKeys.forEpoch(chatId, envelope.epoch);

      if (!chatKey) {
        // Ключа этой эпохи нет и не будет: она старше самой ранней из наших.
        // Это не поломка, а обещание, данное тем, кто переписывался до нас.
        const earliest = await this.chatKeys.earliestEpoch(chatId);
        const beforeUs = earliest !== null && envelope.epoch < earliest;

        return beforeUs
          ? { text: BEFORE_JOIN_PLACEHOLDER, undecryptable: 'beforeJoin' }
          : { text: KEY_UNAVAILABLE_PLACEHOLDER, undecryptable: 'keyUnavailable' };
      }

      const text = await decryptMessage(chatKey.key, chatId, senderId, envelope);

      // Своё сообщение проверять не у кого и незачем.
      if (senderId === identity.accountId) return { text };

      const senderVerified = envelope.sig
        ? await this.isSenderConfirmed(
            { chatId, epoch: envelope.epoch, senderId, iv: envelope.iv, data: envelope.data },
            envelope.sig
          )
        : false;

      return { text, senderVerified };
    } catch (error) {
      console.warn('Не удалось расшифровать сообщение', error);
      return { text: KEY_UNAVAILABLE_PLACEHOLDER, undecryptable: 'keyUnavailable' };
    }
  }

  async encryptMedia(chatId: string, source: Blob | string): Promise<IEncryptedMedia> {
    const input = await this.normalizeMediaInput(source);
    await this.requireIdentity();

    const { chatKey } = await this.ensureChatKey(chatId);
    if (!chatKey) throw new Error('Ключ шифрования чата недоступен — файл не отправлен');

    const { iv, ciphertext } = await encryptMediaBytes(
      chatKey.key,
      chatId,
      chatKey.epoch,
      input.bytes
    );

    return {
      version: MEDIA_VERSION,
      encrypted: true,
      algorithm: MEDIA_ALGORITHM,
      iv,
      ciphertext,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      keyEpoch: chatKey.epoch,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    };
  }

  async decryptMedia(chatId: string, payload: IEncryptedMedia): Promise<Blob> {
    if (!isEncryptedMediaV2(payload)) {
      throw new Error(
        payload?.encrypted && payload.version !== MEDIA_VERSION
          ? 'Файл сохранён в устаревшем формате'
          : 'Ожидался зашифрованный файл'
      );
    }

    await this.requireIdentity();

    const chatKey = await this.chatKeys.forEpoch(chatId, payload.keyEpoch ?? 1);
    if (!chatKey) throw new Error('Ключ шифрования недоступен');

    const plaintext = await decryptMediaBytes(
      chatKey.key,
      chatId,
      chatKey.epoch,
      payload.iv,
      payload.ciphertext
    );

    return new Blob([plaintext], { type: payload.mimeType || 'application/octet-stream' });
  }

  /** Отпечаток собеседника — код безопасности, который сверяют вслух. */
  async fingerprintOf(userId: string): Promise<string | null> {
    const identity = await this.requireIdentity();
    if (userId === identity.accountId) return identity.fingerprint;

    const peer = await fetchPeerIdentity(this.apiClient, userId);

    return peer?.fingerprint ?? null;
  }

  /** Выход из аккаунта: память чистится, ключи на устройстве остаются. */
  forgetSession(): void {
    this.identity = null;
    this.pendingMasterKey = null;
    this.chatKeys.forget();
    this.backup.forget();
    forgetDerivedKeys();
    forgetPeerIdentities();
    forgetBackupState();
  }

  /**
   * Завершение всех сеансов: ключи стираются с устройства.
   *
   * История при этом не теряется: она в резервной копии и вернётся после
   * входа облачным паролем, passkey или по QR.
   */
  async wipeDevice(): Promise<void> {
    const accountId = this.identity?.accountId ?? this.getAccountId();

    if (accountId) {
      await this.chatKeys.wipe(accountId);
      await this.backup.forgetDevice(accountId);
      await removeKeysWithPrefix(PEER_BUNDLES_PREFIX);
    }

    this.forgetSession();
  }

  async normalizeMediaInput(source: Blob | string | File): Promise<IMediaInput> {
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      return {
        bytes: await source.arrayBuffer(),
        mimeType: source.type || 'application/octet-stream',
        fileName: source instanceof File ? source.name : undefined,
      };
    }

    if (typeof source === 'string') {
      const match = source.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) throw new Error('Файл должен быть data-URL или Blob');

      return {
        bytes: base64ToBytes(match[2]).buffer as ArrayBuffer,
        mimeType: match[1] || 'application/octet-stream',
      };
    }

    throw new Error('Неподдерживаемый вид файла');
  }
}
