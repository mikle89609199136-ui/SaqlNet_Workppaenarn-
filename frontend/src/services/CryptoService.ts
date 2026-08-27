import type { ApiClient } from '@/api';
import { STORAGE_KEYS } from '@/consts';
import { resolveMembers } from '@/core/chatResolver';
import { ChatKeyManager, type IKeyDistribution } from '@/crypto/chatKeys';
import { base64ToBytes, bytesToBase64 } from '@/crypto/encoding';
import {
  decryptMediaBytes,
  decryptMessage,
  encryptMediaBytes,
  encryptMessage,
  forgetDerivedKeys,
  isLegacyContent,
  parseEnvelope,
} from '@/crypto/envelope';
import {
  fetchPeerIdentity,
  forgetPeerIdentities,
  knownPeerIdentities,
  loadOrCreateIdentity,
  PEER_BUNDLES_PREFIX,
  publishIdentity,
  type ILocalIdentity,
} from '@/crypto/identity';
import { removeKey, removeKeysWithPrefix } from '@/crypto/keyStore';
import { signParts, verifyParts, type ISignedParts } from '@/crypto/signing';
import type { IEncryptedMedia } from '@/types';

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

export const LEGACY_MESSAGE_PLACEHOLDER = '🔒 Сообщение в устаревшем формате';
export const KEY_UNAVAILABLE_PLACEHOLDER = '🔒 Ключ шифрования недоступен';
export const MEDIA_VERSION = 2;

const MEDIA_ALGORITHM = 'AES-GCM';

interface IMediaInput {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName?: string;
}

export interface IDecryptedMessage {
  text: string;
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

  /** Кто из участников ещё не публиковал ключи — для подсказки в интерфейсе. */
  private membersWithoutKeys = new Map<string, string[]>();

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
    this.chatKeys = new ChatKeyManager({
      apiClient,
      identity: () => this.requireIdentity(),
      members: async (chatId) => (await resolveMembers(chatId)).map((member) => member.id),
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
   * Ключи создаются один раз на аккаунт и публикуются связкой. Повторный
   * вызов ничего не пересоздаёт: пересозданная пара означала бы, что вся
   * прежняя переписка стала нечитаемой.
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
    if (!accountId || !this.hasWebCrypto()) return null;

    if (this.identity?.accountId === accountId) return this.identity;

    const identity = await loadOrCreateIdentity(accountId);
    this.identity = identity;

    // Наследие прежней схемы: одиночная пара и заглушка группового
    // состояния. Ни то ни другое больше не читается.
    await removeKey(`signal_keypair:${accountId}`);
    await removeKeysWithPrefix(`mls_state:${accountId}`);

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

    if (!identity) throw new Error('Шифрование недоступно: откройте приложение по HTTPS');

    return identity;
  }

  private rememberGaps(chatId: string, distribution: IKeyDistribution): IKeyDistribution {
    if (distribution.membersWithoutIdentity.length > 0) {
      this.membersWithoutKeys.set(chatId, distribution.membersWithoutIdentity);
    } else {
      this.membersWithoutKeys.delete(chatId);
    }

    return distribution;
  }

  /** Кто в этом чате пока не сможет прочитать написанное. */
  membersWithoutEncryption(chatId: string): string[] {
    return this.membersWithoutKeys.get(chatId) ?? [];
  }

  async ensureChatKey(chatId: string): Promise<IKeyDistribution> {
    await this.requireIdentity();
    return this.rememberGaps(chatId, await this.chatKeys.ensure(chatId));
  }

  async rotateChatKey(chatId: string): Promise<IKeyDistribution> {
    await this.requireIdentity();
    return this.rememberGaps(chatId, await this.chatKeys.rotate(chatId));
  }

  async healChatKeys(chatId: string): Promise<IKeyDistribution> {
    await this.requireIdentity();
    return this.rememberGaps(chatId, await this.chatKeys.heal(chatId));
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
    if (!this.hasWebCrypto()) return { text: KEY_UNAVAILABLE_PLACEHOLDER };

    const envelope = parseEnvelope(content);

    if (!envelope) {
      return { text: isLegacyContent(content) ? LEGACY_MESSAGE_PLACEHOLDER : content };
    }

    try {
      const identity = await this.requireIdentity();
      const chatKey = await this.chatKeys.forEpoch(chatId, envelope.epoch);

      if (!chatKey) return { text: KEY_UNAVAILABLE_PLACEHOLDER };

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
      return { text: KEY_UNAVAILABLE_PLACEHOLDER };
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
    if (!payload?.encrypted || payload.algorithm !== MEDIA_ALGORITHM) {
      throw new Error('Ожидался зашифрованный файл');
    }

    if (payload.version !== MEDIA_VERSION) {
      throw new Error('Файл сохранён в устаревшем формате');
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
    this.membersWithoutKeys.clear();
    this.chatKeys.forget();
    forgetDerivedKeys();
    forgetPeerIdentities();
  }

  /** Завершение всех сеансов: ключи стираются с устройства. */
  async wipeDevice(): Promise<void> {
    const accountId = this.identity?.accountId ?? this.getAccountId();

    if (accountId) {
      await this.chatKeys.wipe(accountId);
      await removeKey(`identity:${accountId}`);
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

  /** Свой публичный ключ в base64 — для отладки и совместимости с тестами. */
  async exportPublicKey(): Promise<string | null> {
    const identity = this.identity ?? (await this.init());
    return identity?.bundle ?? null;
  }
}

export { bytesToBase64 };
