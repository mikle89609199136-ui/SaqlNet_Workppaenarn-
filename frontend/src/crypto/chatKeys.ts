import type { ApiClient } from '@/shared/api';
import { API_ENDPOINTS } from '@/shared/api';
import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from './encoding';
import { deriveWrapKey } from './envelope';
import { fetchPeerIdentity, type ILocalIdentity, type IPublicIdentity } from './identity';
import { listKeys, readKey, removeKeysWithPrefix, writeKey } from './keyStore';

/**
 * Ключ чата и его раздача участникам.
 *
 * У чата один симметричный ключ, общий для всех участников, с номером
 * эпохи. Он заворачивается отдельно для каждого — общим секретом ECDH
 * между заворачивающим и получателем, — и в таком виде лежит на сервере.
 * Сервер видит только запечатанные блобы, поэтому не может ни прочитать
 * переписку, ни подсунуть свой ключ: развернуть блоб получится лишь
 * приватным ключом получателя.
 *
 * Личный чат ничем не отличается от группового — это чат из двоих.
 *
 * Эпоха меняется при смене состава: новый участник не получает прежний
 * ключ и не читает написанное до него, ушедший теряет доступ к
 * написанному после. Прежние эпохи остаются на устройстве, поэтому своя
 * история продолжает открываться.
 */

const WRAP_VERSION = 2;
const KEY_BYTES = 32;
const HEAL_INTERVAL_MS = 60 * 1000;
const ROTATE_INTERVAL_MS = 60 * 1000;

/**
 * Как часто сверять свою эпоху с сервером.
 *
 * Ключ чата мог смениться, пока мы держали свой в памяти: например,
 * участник вошёл с нового устройства, не сумел развернуть свою строку и
 * начал новую эпоху. Не сверяясь, мы продолжали бы шифровать ключом,
 * которого больше ни у кого нет, — и собеседники видели бы замок вместо
 * сообщений. Проверено вживую.
 */
const VERIFY_INTERVAL_MS = 30 * 1000;

export interface IChatKey {
  key: Uint8Array;
  epoch: number;
}

/** Итог раздачи: кому ключ не достался и почему. */
export interface IKeyDistribution {
  chatKey: IChatKey | null;
  membersWithoutIdentity: string[];
}

interface IWrappedKey {
  v: number;
  iv: string;
  ct: string;
  senderId: string;
  recipientFp: string;
}

interface IServerChatKey {
  userId: string;
  encryptedKey: string;
  senderKeyId?: string;
  keyEpoch: number;
}

export interface IChatKeyDeps {
  apiClient: ApiClient;
  identity: () => Promise<ILocalIdentity>;
  members: (chatId: string) => Promise<string[]>;
}

function wrapInfo(epoch: number, senderFp: string, recipientFp: string): string {
  return `craneapp/e2e/v2/wrap|${epoch}|${senderFp}|${recipientFp}`;
}

/**
 * Разбор завёрнутого ключа.
 *
 * Строка приходит с сервера, то есть содержать может что угодно. Приведение
 * типа здесь ничего не проверяло бы: отсутствующее поле стало бы `undefined`
 * и всплыло бы позже, в середине криптографической операции, — там это
 * выглядит как «ключ не подошёл», а не как «данные не те».
 */
function parseWrappedKey(encryptedKey: string): IWrappedKey | null {
  try {
    const parsed: unknown = JSON.parse(bytesToUtf8(base64ToBytes(encryptedKey)));

    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;

    if (
      candidate.v !== WRAP_VERSION ||
      typeof candidate.iv !== 'string' ||
      typeof candidate.ct !== 'string' ||
      typeof candidate.senderId !== 'string' ||
      typeof candidate.recipientFp !== 'string'
    ) {
      return null;
    }

    return candidate as unknown as IWrappedKey;
  } catch {
    return null;
  }
}

export class ChatKeyManager {
  private deps: IChatKeyDeps;

  private keys = new Map<string, IChatKey>();

  private lastHealAt = new Map<string, number>();

  private lastRotateAt = new Map<string, number>();

  private lastVerifiedAt = new Map<string, number>();

  constructor(deps: IChatKeyDeps) {
    this.deps = deps;
  }

  private storageKey(accountId: string, chatId: string, epoch: number): string {
    return `chatkey:${accountId}:${chatId}:${epoch}`;
  }

  private latestKey(accountId: string, chatId: string): string {
    return `chatkey-latest:${accountId}:${chatId}`;
  }

  private async remember(chatId: string, chatKey: IChatKey): Promise<void> {
    const { accountId } = await this.deps.identity();

    this.keys.set(`${chatId}:${chatKey.epoch}`, chatKey);
    await writeKey(this.storageKey(accountId, chatId, chatKey.epoch), bytesToBase64(chatKey.key));

    const latest = await readKey<number>(this.latestKey(accountId, chatId));
    if (latest === undefined || latest < chatKey.epoch) {
      await writeKey(this.latestKey(accountId, chatId), chatKey.epoch);
    }
  }

  /** Ключ нужной эпохи, если он уже есть на устройстве. */
  private async local(chatId: string, epoch?: number): Promise<IChatKey | null> {
    const { accountId } = await this.deps.identity();
    const wanted = epoch ?? (await readKey<number>(this.latestKey(accountId, chatId)));

    if (wanted === undefined) return null;

    const cached = this.keys.get(`${chatId}:${wanted}`);
    if (cached) return cached;

    const stored = await readKey<string>(this.storageKey(accountId, chatId, wanted));
    if (!stored) return null;

    const chatKey: IChatKey = { key: base64ToBytes(stored), epoch: wanted };
    this.keys.set(`${chatId}:${wanted}`, chatKey);

    return chatKey;
  }

  private async wrapFor(
    chatId: string,
    chatKey: IChatKey,
    recipientId: string,
    recipient: IPublicIdentity
  ): Promise<IServerChatKey> {
    const identity = await this.deps.identity();

    const secret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: recipient.ecdh },
      identity.ecdhPrivate,
      256
    );

    const wrapKey = await deriveWrapKey(
      new Uint8Array(secret),
      chatId,
      wrapInfo(chatKey.epoch, identity.fingerprint, recipient.fingerprint)
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, chatKey.key);

    const wrapped: IWrappedKey = {
      v: WRAP_VERSION,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(ciphertext),
      senderId: identity.accountId,
      recipientFp: recipient.fingerprint,
    };

    return {
      userId: recipientId,
      encryptedKey: bytesToBase64(utf8ToBytes(JSON.stringify(wrapped))),
      // Отправляется всегда: запись той же эпохой перезаписывает строку и
      // затирает это поле, если его не прислать.
      senderKeyId: identity.fingerprint,
      keyEpoch: chatKey.epoch,
    };
  }

  private async unwrap(
    chatId: string,
    row: IServerChatKey,
    { fresh = false }: { fresh?: boolean } = {}
  ): Promise<IChatKey | null> {
    const wrapped = parseWrappedKey(row.encryptedKey);
    if (!wrapped) return null;

    try {
      const identity = await this.deps.identity();
      // Отправитель берётся из блоба, но доверия к нему не требуется: его
      // связка тянется с сервера, и подмена имени сломает общий секрет.
      const sender =
        wrapped.senderId === identity.accountId
          ? identity
          : await fetchPeerIdentity(this.deps.apiClient, wrapped.senderId, { fresh });

      if (!sender) return null;

      const secret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: sender.ecdh },
        identity.ecdhPrivate,
        256
      );

      const wrapKey = await deriveWrapKey(
        new Uint8Array(secret),
        chatId,
        wrapInfo(row.keyEpoch, sender.fingerprint, identity.fingerprint)
      );

      const key = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(wrapped.iv) },
        wrapKey,
        base64ToBytes(wrapped.ct)
      );

      return { key: new Uint8Array(key), epoch: row.keyEpoch };
    } catch (error) {
      // Молчать здесь нельзя: снаружи это выглядит как «ключа нет», и
      // клиент начинает новую эпоху вместо того, чтобы понять причину.
      if (!fresh) return null;

      // Со свежей связкой отправителя развернуть тоже не вышло — значит
      // ключ действительно не наш, а не просто устаревшие сведения о нём.
      console.warn(`Не удалось развернуть ключ чата ${chatId}, эпоха ${row.keyEpoch}`, error);
      return null;
    }
  }

  /** Забрать свою копию ключа с сервера и принять её. */
  async acceptFromServer(chatId: string): Promise<IChatKey | null> {
    try {
      const response = await this.deps.apiClient.get<IServerChatKey>(
        API_ENDPOINTS.ENCRYPTION_MY_KEY(chatId)
      );
      if (!response.data?.encryptedKey) return null;

      // Первая попытка — с тем, что известно о собеседнике; вторая — с
      // заново запрошенной связкой. Человек мог войти с нового устройства
      // ровно после того, как мы запомнили прежнюю.
      const chatKey =
        (await this.unwrap(chatId, response.data)) ??
        (await this.unwrap(chatId, response.data, { fresh: true }));

      if (chatKey) await this.remember(chatId, chatKey);

      return chatKey;
    } catch {
      // 404 — ключа ещё нет. Это обычное состояние нового чата.
      return null;
    }
  }

  private async publish(chatId: string, rows: IServerChatKey[], epoch: number, rotate: boolean) {
    const payload = { encryptedKeys: rows, keyEpoch: epoch };

    if (!rotate) {
      await this.deps.apiClient.post(API_ENDPOINTS.ENCRYPTION_CHAT_KEYS(chatId), payload);
      return;
    }

    try {
      await this.deps.apiClient.post(API_ENDPOINTS.ENCRYPTION_CHAT_KEY_ROTATE(chatId), payload);
    } catch (error) {
      // Ротаций разрешено десять в час, у обычной записи предела нет.
      // Упереться в лимит и остаться без ключей — хуже, чем потерять
      // запись в журнале ротаций.
      const status = (error as { status?: number })?.status;
      if (status !== 429) throw error;

      await this.deps.apiClient.post(API_ENDPOINTS.ENCRYPTION_CHAT_KEYS(chatId), payload);
    }
  }

  private async distribute(
    chatId: string,
    chatKey: IChatKey,
    memberIds: string[],
    rotate: boolean
  ): Promise<IKeyDistribution> {
    const identity = await this.deps.identity();
    const rows: IServerChatKey[] = [];
    const withoutIdentity: string[] = [];

    for (const memberId of memberIds) {
      const recipient =
        memberId === identity.accountId
          ? identity
          : await fetchPeerIdentity(this.deps.apiClient, memberId);

      if (!recipient) {
        withoutIdentity.push(memberId);
        continue;
      }

      rows.push(await this.wrapFor(chatId, chatKey, memberId, recipient));
    }

    if (rows.length > 0) await this.publish(chatId, rows, chatKey.epoch, rotate);

    await this.remember(chatId, chatKey);

    // Запись не транзакционна, а понижение эпохи сервер отбрасывает молча:
    // по ответу не понять, чей ключ в итоге лежит. Поэтому — перечитать и
    // принять то, что там оказалось.
    const accepted = await this.acceptFromServer(chatId);

    return {
      chatKey: accepted ?? chatKey,
      membersWithoutIdentity: withoutIdentity,
    };
  }

  /**
   * Наибольшая эпоха, до которой чат уже дожил.
   *
   * Нумерацию нельзя начинать заново, даже когда своя строка не
   * разворачивается: сервер молча отбрасывает запись с эпохой ниже
   * имеющейся, и новый ключ никуда бы не лёг — а клиент считал бы, что
   * лёг, и шифровал бы им сообщения, которых не прочтёт никто.
   */
  private async highestEpoch(chatId: string): Promise<number> {
    try {
      const response = await this.deps.apiClient.get<{ keys?: IServerChatKey[] }>(
        API_ENDPOINTS.ENCRYPTION_CHAT_KEYS(chatId)
      );

      return (response.data?.keys ?? []).reduce((top, row) => Math.max(top, row.keyEpoch), 0);
    } catch {
      return 0;
    }
  }

  /** Ключ чата: с устройства, с сервера или новый. */
  async ensure(chatId: string): Promise<IKeyDistribution> {
    const local = await this.local(chatId);

    if (local) {
      const checkedAt = this.lastVerifiedAt.get(chatId) ?? 0;
      if (Date.now() - checkedAt < VERIFY_INTERVAL_MS) {
        return { chatKey: local, membersWithoutIdentity: [] };
      }

      this.lastVerifiedAt.set(chatId, Date.now());
      const current = await this.acceptFromServer(chatId);

      return {
        chatKey: current && current.epoch > local.epoch ? current : local,
        membersWithoutIdentity: [],
      };
    }

    const remote = await this.acceptFromServer(chatId);
    if (remote) return { chatKey: remote, membersWithoutIdentity: [] };

    this.lastVerifiedAt.set(chatId, Date.now());

    const memberIds = await this.deps.members(chatId);
    const fresh: IChatKey = {
      key: crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
      epoch: (await this.highestEpoch(chatId)) + 1,
    };

    return this.distribute(chatId, fresh, memberIds, false);
  }

  /** Новый ключ и новая эпоха: состав чата изменился. */
  async rotate(chatId: string): Promise<IKeyDistribution> {
    const last = this.lastRotateAt.get(chatId) ?? 0;
    if (Date.now() - last < ROTATE_INTERVAL_MS) {
      const current = await this.local(chatId);
      return { chatKey: current, membersWithoutIdentity: [] };
    }
    this.lastRotateAt.set(chatId, Date.now());

    const current = (await this.local(chatId)) ?? (await this.acceptFromServer(chatId));
    const memberIds = await this.deps.members(chatId);

    const next: IChatKey = {
      key: crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
      epoch: Math.max(current?.epoch ?? 0, await this.highestEpoch(chatId)) + 1,
    };

    return this.distribute(chatId, next, memberIds, true);
  }

  /**
   * Доворачивание ключа тем, у кого его нет.
   *
   * Строка участника может отсутствовать (он появился позже), отстать по
   * эпохе (вернулся в чат — прежняя строка воскресает) или быть завёрнутой
   * для другого ключа (человек сменил устройство). Во всех трёх случаях
   * ключ надо завернуть заново.
   */
  async heal(chatId: string): Promise<IKeyDistribution> {
    const last = this.lastHealAt.get(chatId) ?? 0;
    if (Date.now() - last < HEAL_INTERVAL_MS) {
      return { chatKey: await this.local(chatId), membersWithoutIdentity: [] };
    }
    this.lastHealAt.set(chatId, Date.now());

    const chatKey = await this.local(chatId);
    if (!chatKey) return { chatKey: null, membersWithoutIdentity: [] };

    const [rows, memberIds] = await Promise.all([
      this.deps.apiClient
        .get<{ keys?: IServerChatKey[] }>(API_ENDPOINTS.ENCRYPTION_CHAT_KEYS(chatId))
        .then((response) => response.data?.keys ?? [])
        .catch(() => [] as IServerChatKey[]),
      this.deps.members(chatId),
    ]);

    const byUser = new Map(rows.map((row) => [row.userId, row]));
    const identity = await this.deps.identity();
    const stale: string[] = [];
    const withoutIdentity: string[] = [];

    for (const memberId of memberIds) {
      const recipient =
        memberId === identity.accountId
          ? identity
          : await fetchPeerIdentity(this.deps.apiClient, memberId);

      if (!recipient) {
        withoutIdentity.push(memberId);
        continue;
      }

      const row = byUser.get(memberId);
      if (!row || row.keyEpoch < chatKey.epoch) {
        stale.push(memberId);
        continue;
      }

      const wrappedFor = this.recipientOf(row);
      if (wrappedFor !== recipient.fingerprint) stale.push(memberId);
    }

    if (stale.length === 0) return { chatKey, membersWithoutIdentity: withoutIdentity };

    return this.distribute(chatId, chatKey, stale, false);
  }

  /** Для кого завёрнута строка. Читается без расшифровки — это не тайна. */
  private recipientOf(row: IServerChatKey): string | null {
    return parseWrappedKey(row.encryptedKey)?.recipientFp ?? null;
  }

  /**
   * Ключ для сообщения известной эпохи.
   *
   * Если эпоха незнакомая — сообщение написано после ротации, о которой
   * это устройство ещё не слышало: забираем свою копию с сервера.
   */
  async forEpoch(chatId: string, epoch: number): Promise<IChatKey | null> {
    const known = await this.local(chatId, epoch);
    if (known) return known;

    const accepted = await this.acceptFromServer(chatId);

    return accepted?.epoch === epoch ? accepted : this.local(chatId, epoch);
  }

  /**
   * Самая ранняя эпоха, ключ которой есть на устройстве.
   *
   * По ней видно, что сообщение написано до нашего появления в чате: при
   * вступлении раздаётся новая эпоха, а прежние остаются недоступны — это
   * не поломка, а обещание, данное тем, кто переписывался до нас.
   */
  async earliestEpoch(chatId: string): Promise<number | null> {
    const { accountId } = await this.deps.identity();
    const prefix = `chatkey:${accountId}:${chatId}:`;
    const epochs = (await listKeys(prefix)).map((key) => Number(key.slice(prefix.length)));

    return epochs.length > 0 ? Math.min(...epochs) : null;
  }

  forget(): void {
    this.keys.clear();
    this.lastHealAt.clear();
    this.lastRotateAt.clear();
    this.lastVerifiedAt.clear();
  }

  /** Полное стирание: завершение всех сеансов. */
  async wipe(accountId: string): Promise<void> {
    this.forget();
    await removeKeysWithPrefix(`chatkey:${accountId}:`);
    await removeKeysWithPrefix(`chatkey-latest:${accountId}:`);
  }
}
