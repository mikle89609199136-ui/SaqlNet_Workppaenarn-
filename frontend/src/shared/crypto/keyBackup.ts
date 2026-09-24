import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from './encoding';

/**
 * Резервная копия ключей (#742).
 *
 * История переписки открывается ключами, которые живут на устройстве. Чтобы
 * она была доступна на любом устройстве, ключи уходят на сервер — но только
 * зашифрованными мастер-ключом копии `M`, которого сервер не видит.
 *
 * Сам `M` открывается одним из слотов: облачным паролем, passkey или
 * передачей с уже вошедшего устройства по QR. Слотов несколько, ключ один:
 * смена пароля перешифровывает несколько байт, а не всю копию.
 *
 * Подменить копию сервер не может. Чужую личность он не завернёт под наш
 * пароль — пароля он не знает; чужой `M` не откроет нашу личность — она
 * запечатана нашим, и к ней привязан идентификатор аккаунта.
 */

export const BACKUP_FORMAT_VERSION = 1;

const MASTER_KEY_BYTES = 32;
const SALT_BYTES = 16;
const SEAL_VERSION = 1;

export interface IArgon2Params {
  /** Память, КиБ. */
  m: number;
  /** Число проходов. */
  t: number;
  /** Параллельность. */
  p: number;
}

/**
 * Стоимость подбора облачного пароля.
 *
 * Копия лежит на сервере, и перебирать пароль по ней можно без ограничения
 * попыток. Argon2id заставляет каждую попытку тратить 64 МиБ памяти — это
 * то, что делает перебор на видеокартах дорогим. В браузере одна проверка
 * занимает около секунды, и это цена, которую платит только тот, кто
 * вводит пароль.
 */
export const ARGON2_PARAMS: IArgon2Params = { m: 65536, t: 3, p: 1 };

export interface IPasswordSlot {
  type: 'password';
  id: string;
  kdf: { alg: 'argon2id' } & IArgon2Params;
  salt: string;
  iv: string;
  ct: string;
}

export interface IPasskeySlot {
  type: 'passkey';
  id: string;
  credentialId: string;
  prfSalt: string;
  iv: string;
  ct: string;
}

export type TBackupSlot = IPasswordSlot | IPasskeySlot;

/** Личность в переносимом виде — ровно то, что запечатывается в копию. */
export interface IPortableIdentity {
  ecdhPkcs8: string;
  ecdsaPkcs8: string;
  bundle: string;
}

interface ISealed {
  v: number;
  iv: string;
  ct: string;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function randomId(): string {
  return bytesToBase64(randomBytes(9)).replace(/[+/=]/g, '');
}

async function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Отдельный ключ под каждое назначение: личность и ключи чатов не делят один. */
async function deriveFromMaster(
  master: Uint8Array<ArrayBuffer>,
  purpose: string
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: utf8ToBytes(`craneapp/backup/v1/${purpose}`),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function sealBytes(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: string
): Promise<ISealed> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8ToBytes(aad) },
    key,
    plaintext
  );

  return { v: SEAL_VERSION, iv: bytesToBase64(iv), ct: bytesToBase64(ciphertext) };
}

async function openBytes(
  key: CryptoKey,
  sealed: ISealed,
  aad: string
): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.v !== SEAL_VERSION) throw new Error('Неизвестный формат резервной копии');

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(sealed.iv), additionalData: utf8ToBytes(aad) },
    key,
    base64ToBytes(sealed.ct)
  );

  return new Uint8Array(plaintext);
}

function encodeSealed(sealed: ISealed): string {
  return bytesToBase64(utf8ToBytes(JSON.stringify(sealed)));
}

function decodeSealed(value: string): ISealed {
  const parsed: unknown = JSON.parse(bytesToUtf8(base64ToBytes(value)));
  const candidate = parsed as Partial<ISealed> | null;

  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.v !== 'number' ||
    typeof candidate.iv !== 'string' ||
    typeof candidate.ct !== 'string'
  ) {
    throw new Error('Повреждённая запись резервной копии');
  }

  return candidate as ISealed;
}

export function generateMasterKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(MASTER_KEY_BYTES);
}

export async function sealIdentity(
  master: Uint8Array<ArrayBuffer>,
  accountId: string,
  identity: IPortableIdentity
): Promise<string> {
  const key = await deriveFromMaster(master, 'identity');
  const plaintext = utf8ToBytes(JSON.stringify(identity));

  return encodeSealed(await sealBytes(key, plaintext, `identity|${accountId}`));
}

export async function openIdentity(
  master: Uint8Array<ArrayBuffer>,
  accountId: string,
  sealed: string
): Promise<IPortableIdentity> {
  const key = await deriveFromMaster(master, 'identity');
  const plaintext = await openBytes(key, decodeSealed(sealed), `identity|${accountId}`);
  const identity = JSON.parse(bytesToUtf8(plaintext)) as Partial<IPortableIdentity>;

  if (
    typeof identity.ecdhPkcs8 !== 'string' ||
    typeof identity.ecdsaPkcs8 !== 'string' ||
    typeof identity.bundle !== 'string'
  ) {
    throw new Error('Повреждённая личность в резервной копии');
  }

  return identity as IPortableIdentity;
}

/** Ключ чата привязан к чату и эпохе: переставить записи местами нельзя. */
export async function sealChatKey(
  master: Uint8Array<ArrayBuffer>,
  chatId: string,
  epoch: number,
  chatKey: Uint8Array
): Promise<string> {
  const key = await deriveFromMaster(master, 'chat-key');

  return encodeSealed(await sealBytes(key, new Uint8Array(chatKey), `chat-key|${chatId}|${epoch}`));
}

export async function openChatKey(
  master: Uint8Array<ArrayBuffer>,
  chatId: string,
  epoch: number,
  sealed: string
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await deriveFromMaster(master, 'chat-key');

  return openBytes(key, decodeSealed(sealed), `chat-key|${chatId}|${epoch}`);
}

function slotAad(slot: Pick<TBackupSlot, 'type' | 'id'>): string {
  return `slot|${slot.type}|${slot.id}`;
}

/**
 * Ключ из облачного пароля.
 *
 * Argon2id подгружается лениво: это WebAssembly, и нужен он только на
 * экранах пароля, а не при каждом открытии приложения.
 */
async function passwordKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  params: IArgon2Params
): Promise<CryptoKey> {
  const { argon2id } = await import('hash-wasm');
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: 'binary',
  });

  return importAesKey(new Uint8Array(hash));
}

export async function createPasswordSlot(
  master: Uint8Array<ArrayBuffer>,
  password: string,
  params: IArgon2Params = ARGON2_PARAMS
): Promise<IPasswordSlot> {
  const salt = randomBytes(SALT_BYTES);
  const id = randomId();
  const kdf = { alg: 'argon2id' as const, ...params };
  const sealed = await sealBytes(
    await passwordKey(password, salt, params),
    master,
    slotAad({ type: 'password', id })
  );

  return { type: 'password', id, kdf, salt: bytesToBase64(salt), iv: sealed.iv, ct: sealed.ct };
}

/** `null` — пароль не подошёл. */
export async function openPasswordSlot(
  slot: IPasswordSlot,
  password: string
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const key = await passwordKey(password, base64ToBytes(slot.salt), slot.kdf);

    return await openBytes(key, { v: SEAL_VERSION, iv: slot.iv, ct: slot.ct }, slotAad(slot));
  } catch {
    return null;
  }
}

/** Ключ из секрета PRF: он уже случайный, растягивать его не нужно. */
async function passkeyKey(prfOutput: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return deriveFromMaster(prfOutput, 'passkey-slot');
}

export async function createPasskeySlot(
  master: Uint8Array<ArrayBuffer>,
  credentialId: string,
  prfSalt: Uint8Array<ArrayBuffer>,
  prfOutput: Uint8Array<ArrayBuffer>
): Promise<IPasskeySlot> {
  const id = randomId();
  const sealed = await sealBytes(
    await passkeyKey(prfOutput),
    master,
    slotAad({ type: 'passkey', id })
  );

  return {
    type: 'passkey',
    id,
    credentialId,
    prfSalt: bytesToBase64(prfSalt),
    iv: sealed.iv,
    ct: sealed.ct,
  };
}

/** `null` — секрет не от этого passkey. */
export async function openPasskeySlot(
  slot: IPasskeySlot,
  prfOutput: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await openBytes(
      await passkeyKey(prfOutput),
      { v: SEAL_VERSION, iv: slot.iv, ct: slot.ct },
      slotAad(slot)
    );
  } catch {
    return null;
  }
}

export function isBackupSlot(value: unknown): value is TBackupSlot {
  if (typeof value !== 'object' || value === null) return false;

  const slot = value as Record<string, unknown>;
  const sealed =
    typeof slot.id === 'string' && typeof slot.iv === 'string' && typeof slot.ct === 'string';

  if (slot.type === 'password') {
    const kdf = slot.kdf as Record<string, unknown> | undefined;
    return (
      sealed &&
      typeof slot.salt === 'string' &&
      kdf?.alg === 'argon2id' &&
      typeof kdf.m === 'number' &&
      typeof kdf.t === 'number' &&
      typeof kdf.p === 'number'
    );
  }

  if (slot.type === 'passkey') {
    return sealed && typeof slot.credentialId === 'string' && typeof slot.prfSalt === 'string';
  }

  return false;
}
