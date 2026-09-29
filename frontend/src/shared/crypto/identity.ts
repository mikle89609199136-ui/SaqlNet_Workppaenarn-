import { API_ENDPOINTS, type ApiClient } from '@/shared/api';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, utf8ToBytes } from './encoding';
import type { IPortableIdentity } from './keyBackup';
import { readKey, writeKey } from './keyStore';
import { noteIdentityChange } from './securityNotices';

/**
 * Личность аккаунта: две пары ключей и их отпечаток.
 *
 * ECDH разворачивает ключи чатов, ECDSA подписывает сообщения. Пара
 * создаётся сразу обе, хотя подпись появится этапом позже: связка
 * публикуется целиком, и добавлять в неё ключ потом значило бы менять
 * отпечаток у всех — то есть на ровном месте сообщать собеседникам, что
 * ключ сменился.
 *
 * Приватные части неизвлекаемы. Они хранятся объектами `CryptoKey`, и
 * вынести их наружу нельзя ни экспортом, ни чтением базы: WebCrypto просто
 * откажет. Публичные части извлекаемы всегда — их и публикуем.
 */

const IDENTITY_VERSION = 2;
const PEER_CACHE_TTL_MS = 60 * 1000;

const ECDH_ALGORITHM: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

interface IStoredIdentity {
  version: number;
  ecdhPrivate: CryptoKey;
  ecdhPublic: CryptoKey;
  ecdsaPrivate: CryptoKey;
  ecdsaPublic: CryptoKey;
  bundle: string;
  fingerprint: string;
}

/** Публичная часть — то, что известно о собеседнике. */
export interface IPublicIdentity {
  bundle: string;
  fingerprint: string;
  ecdh: CryptoKey;
  ecdsa: CryptoKey;
}

/** Своя личность: то же плюс приватные части. */
export interface ILocalIdentity extends IPublicIdentity {
  accountId: string;
  ecdhPrivate: CryptoKey;
  ecdsaPrivate: CryptoKey;
}

interface IBundleShape {
  v: number;
  ecdh: string;
  ecdsa: string;
}

interface IKeyResponse {
  publicKey?: string;
  keyId?: string;
}

const peerCache = new Map<string, { identity: IPublicIdentity | null; at: number }>();

export const PEER_BUNDLES_PREFIX = 'peerbundles:';

/** Сколько прежних связок помнить о человеке. */
const PEER_HISTORY_LIMIT = 5;

/**
 * Запомнить связку собеседника.
 *
 * Нужно для проверки подписи: человек мог сменить устройство после того,
 * как отправил сообщение, и его прежние сообщения подписаны ключом,
 * которого на сервере уже нет. Без истории они выглядели бы поддельными.
 */
async function rememberPeerBundle(userId: string, bundle: string): Promise<void> {
  const storageKey = `${PEER_BUNDLES_PREFIX}${userId}`;
  const known = (await readKey<string[]>(storageKey)) ?? [];

  if (known.includes(bundle)) return;

  await writeKey(storageKey, [...known, bundle].slice(-PEER_HISTORY_LIMIT));

  // Первая связка сменой не считается: до неё мы о человеке ничего не знали.
  const previous = known.at(-1);
  if (!previous) return;

  await noteIdentityChange(
    userId,
    await fingerprintOfBundle(previous),
    await fingerprintOfBundle(bundle)
  );
}

/** Связки, которые мы видели у этого человека раньше. */
export async function knownPeerIdentities(userId: string): Promise<IPublicIdentity[]> {
  const bundles = (await readKey<string[]>(`${PEER_BUNDLES_PREFIX}${userId}`)) ?? [];
  const identities = await Promise.all(bundles.map((bundle) => decodeBundle(bundle)));

  return identities.filter((identity): identity is IPublicIdentity => identity !== null);
}

function identityStorageKey(accountId: string): string {
  return `identity:${accountId}`;
}

async function exportSpki(key: CryptoKey): Promise<string> {
  return bytesToBase64(await crypto.subtle.exportKey('spki', key));
}

function importEcdhPublic(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64ToBytes(spkiBase64), ECDH_ALGORITHM, true, []);
}

function importEcdsaPublic(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64ToBytes(spkiBase64), ECDSA_ALGORITHM, true, [
    'verify',
  ]);
}

/**
 * Отпечаток связки.
 *
 * Считается всегда сами, из самой связки. Поле `keyId` с сервера для этого
 * не годится: его значение выбирает тот, кто публикует ключ, а проверять
 * подлинность собеседника по данным, которые он же и прислал, бессмысленно.
 */
export async function fingerprintOfBundle(bundle: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8ToBytes(bundle));
  return bytesToBase64Url(digest);
}

export function encodeBundle(ecdhSpki: string, ecdsaSpki: string): string {
  const shape: IBundleShape = { v: IDENTITY_VERSION, ecdh: ecdhSpki, ecdsa: ecdsaSpki };
  return bytesToBase64(utf8ToBytes(JSON.stringify(shape)));
}

/**
 * Разбор связки.
 *
 * `null` означает «связки нет»: собеседник ещё не входил с новой версией и
 * опубликовал прежний одиночный ключ. Это не ошибка, а состояние, в
 * котором завернуть для него ключ чата нельзя.
 */
export async function decodeBundle(bundle: string): Promise<IPublicIdentity | null> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(bundle)));

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as IBundleShape).v !== IDENTITY_VERSION ||
      typeof (parsed as IBundleShape).ecdh !== 'string' ||
      typeof (parsed as IBundleShape).ecdsa !== 'string'
    ) {
      return null;
    }

    const shape = parsed as IBundleShape;

    return {
      bundle,
      fingerprint: await fingerprintOfBundle(bundle),
      ecdh: await importEcdhPublic(shape.ecdh),
      ecdsa: await importEcdsaPublic(shape.ecdsa),
    };
  } catch {
    return null;
  }
}

async function createIdentity(accountId: string): Promise<IStoredIdentity> {
  // extractable: false относится к приватному ключу. Публичный извлекаем
  // всегда — иначе его нечем было бы опубликовать.
  const ecdh = await crypto.subtle.generateKey(ECDH_ALGORITHM, false, ['deriveBits']);
  // Оба права обязательны: список раздаётся паре, приватному достаётся
  // подпись, публичному — проверка. С одним лишь 'sign' публичный ключ
  // остаётся без прав, и проверка подписи отказывает.
  const ecdsa = await crypto.subtle.generateKey(ECDSA_ALGORITHM, false, ['sign', 'verify']);

  const bundle = encodeBundle(await exportSpki(ecdh.publicKey), await exportSpki(ecdsa.publicKey));

  const stored: IStoredIdentity = {
    version: IDENTITY_VERSION,
    ecdhPrivate: ecdh.privateKey,
    ecdhPublic: ecdh.publicKey,
    ecdsaPrivate: ecdsa.privateKey,
    ecdsaPublic: ecdsa.publicKey,
    bundle,
    fingerprint: await fingerprintOfBundle(bundle),
  };

  await writeKey(identityStorageKey(accountId), stored);

  return stored;
}

function toLocal(accountId: string, stored: IStoredIdentity): ILocalIdentity {
  return {
    accountId,
    bundle: stored.bundle,
    fingerprint: stored.fingerprint,
    ecdh: stored.ecdhPublic,
    ecdsa: stored.ecdsaPublic,
    ecdhPrivate: stored.ecdhPrivate,
    ecdsaPrivate: stored.ecdsaPrivate,
  };
}

/** Личность с устройства, если она там есть. Ничего не создаёт. */
export async function loadIdentity(accountId: string): Promise<ILocalIdentity | null> {
  const stored = await readKey<IStoredIdentity>(identityStorageKey(accountId));

  if (stored?.version === IDENTITY_VERSION && stored.ecdhPrivate && stored.ecdsaPrivate) {
    return toLocal(accountId, stored);
  }

  return null;
}

/**
 * Установка личности из переносимого вида.
 *
 * Приватные части импортируются сразу неизвлекаемыми: на устройстве они
 * живут так же, как созданные на месте, и вынести их отсюда нельзя.
 */
export async function restorePortableIdentity(
  accountId: string,
  portable: IPortableIdentity
): Promise<ILocalIdentity> {
  const publicIdentity = await decodeBundle(portable.bundle);
  if (!publicIdentity) throw new Error('Повреждённая связка в резервной копии');

  const ecdhPrivate = await crypto.subtle.importKey(
    'pkcs8',
    base64ToBytes(portable.ecdhPkcs8),
    ECDH_ALGORITHM,
    false,
    ['deriveBits']
  );
  const ecdsaPrivate = await crypto.subtle.importKey(
    'pkcs8',
    base64ToBytes(portable.ecdsaPkcs8),
    ECDSA_ALGORITHM,
    false,
    ['sign']
  );

  const stored: IStoredIdentity = {
    version: IDENTITY_VERSION,
    ecdhPrivate,
    ecdhPublic: publicIdentity.ecdh,
    ecdsaPrivate,
    ecdsaPublic: publicIdentity.ecdsa,
    bundle: portable.bundle,
    fingerprint: publicIdentity.fingerprint,
  };

  await writeKey(identityStorageKey(accountId), stored);

  return toLocal(accountId, stored);
}

/**
 * Новая личность, которую можно перенести на другие устройства.
 *
 * Извлекаемой пара бывает только здесь, на время одного вызова: её
 * приватные части отдаются наружу, чтобы запечатать в резервную копию.
 * На устройство она попадает через `restorePortableIdentity` — заново
 * импортированной неизвлекаемой, и только после того, как копия легла на
 * сервер: иначе сбой сохранения стоил бы прежней личности.
 */
export async function createPortableIdentity(): Promise<IPortableIdentity> {
  const ecdh = await crypto.subtle.generateKey(ECDH_ALGORITHM, true, ['deriveBits']);
  const ecdsa = await crypto.subtle.generateKey(ECDSA_ALGORITHM, true, ['sign', 'verify']);

  return {
    ecdhPkcs8: bytesToBase64(await crypto.subtle.exportKey('pkcs8', ecdh.privateKey)),
    ecdsaPkcs8: bytesToBase64(await crypto.subtle.exportKey('pkcs8', ecdsa.privateKey)),
    bundle: encodeBundle(await exportSpki(ecdh.publicKey), await exportSpki(ecdsa.publicKey)),
  };
}

export async function loadOrCreateIdentity(accountId: string): Promise<ILocalIdentity> {
  const stored = await readKey<IStoredIdentity>(identityStorageKey(accountId));

  if (stored?.version === IDENTITY_VERSION && stored.ecdhPrivate && stored.ecdsaPrivate) {
    return toLocal(accountId, stored);
  }

  return toLocal(accountId, await createIdentity(accountId));
}

/**
 * Публикация связки.
 *
 * Два маршрута, потому что на сервере две таблицы ключей: `crypto` знает
 * про отпечаток и эпохи, а `auth` отдаёт ключ собеседника в составе чата,
 * и без записи туда чат выглядел бы как чат с человеком без шифрования.
 * Какая таблица останется — решает бэкенд, задача заведена.
 */
export async function publishIdentity(
  apiClient: ApiClient,
  identity: ILocalIdentity
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.ENCRYPTION_KEYS, {
    publicKey: identity.bundle,
    keyId: identity.fingerprint,
  });

  await apiClient.post(API_ENDPOINTS.AUTH_PUBLIC_KEY, { publicKey: identity.bundle });
}

/**
 * Связка собеседника.
 *
 * Кешируется на минуту: она нужна при каждом заворачивании ключа, а
 * меняется редко. `null` — связки нет: либо человек ещё не входил с новой
 * версией, либо у него ключ прежней схемы.
 *
 * `fresh` обходит кеш. Это не роскошь: человек мог войти с нового
 * устройства ровно после того, как мы запомнили прежнюю связку, и тогда
 * завёрнутый им ключ не развернётся. Проверено вживую — собеседник видел
 * замок вместо сообщений, пока кеш не истечёт.
 */
export async function fetchPeerIdentity(
  apiClient: ApiClient,
  userId: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<IPublicIdentity | null> {
  const cached = peerCache.get(userId);
  if (!fresh && cached && Date.now() - cached.at < PEER_CACHE_TTL_MS) return cached.identity;

  let identity: IPublicIdentity | null = null;

  try {
    const response = await apiClient.get<IKeyResponse>(API_ENDPOINTS.ENCRYPTION_KEY_OF(userId));
    identity = response.data?.publicKey ? await decodeBundle(response.data.publicKey) : null;

    if (identity) await rememberPeerBundle(userId, identity.bundle);
  } catch {
    // 404 — ключа нет; остальное тоже не повод падать: заворачивание для
    // этого участника просто не состоится, о чём узнает вызывающий код.
    identity = null;
  }

  peerCache.set(userId, { identity, at: Date.now() });

  return identity;
}

export function forgetPeerIdentities(): void {
  peerCache.clear();
}
