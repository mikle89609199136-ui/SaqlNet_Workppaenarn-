import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from './encoding';
import type { ISignedParts } from './signing';
import { normalizeEntities, type IMessageEntity, type IRichText } from '@/shared/lib/richText';

/**
 * Конверт сообщения: то, что уходит на сервер вместо текста.
 *
 * Ключ шифрования не берётся из общего секрета напрямую — он выводится
 * через HKDF с привязкой к чату и назначению. Отсюда два свойства,
 * которых не было раньше: текст и файлы шифруются разными ключами, а
 * ключ одного чата бесполезен в другом.
 *
 * Шифртекст связан с тем, где и от кого он появился: идентификатор чата,
 * эпоха и отправитель входят в дополнительные данные AES-GCM. Сервер не
 * может ни перевесить сообщение в другой чат, ни переписать автора —
 * расшифровка после такой правки просто не состоится.
 *
 * Имена полей `e2e`, `iv` и `data` выбраны не нами: по ним сервер узнаёт
 * зашифрованное сообщение (`backend-v2/internal/chat/sanitize.go`) — не
 * применяет к нему лимит длины текста и не принимает рядом открытые
 * `entities`. Экранировать содержимое сервер перестал в #799.
 *
 * Две версии. В `v2` внутри шифровки — просто текст. В `v3` — текст
 * вместе с форматированием, `{ text, entities }` (#656): диапазоны жирного,
 * ссылок и прочего — такая же часть сообщения, как сам текст, и сервер не
 * должен видеть даже их. `v3` пишется, только когда форматирование есть:
 * обычное сообщение остаётся `v2`.
 */

export const ENVELOPE_VERSION = 2;

/** Конверт с форматированием: внутри шифровки `{ text, entities }`. */
export const RICH_ENVELOPE_VERSION = 3;

const IV_LENGTH = 12;
const KEY_INFO_PREFIX = 'craneapp/e2e/v2/';

export type TKeyPurpose = 'msg' | 'media' | 'wrap';

export interface IEnvelopeV2 {
  v: number;
  /** Признак для сервера, а не для нас: без него содержимое экранируется. */
  e2e: true;
  epoch: number;
  iv: string;
  data: string;
  /** Отпечаток ключа, которым подписано. Только подсказка, не доказательство. */
  kid?: string;
  sig?: string;
}

/** Кто подписывает исходящее сообщение. */
export interface IEnvelopeSigner {
  fingerprint: string;
  sign(parts: ISignedParts): Promise<string>;
}

/**
 * Выведенные ключи живут, пока живёт вкладка: вывод стоит дороже хранения.
 *
 * В ключ кеша входит сам ключ чата, а не только чат и эпоха. Сервер
 * разрешает перезаписать строку той же эпохой другим ключом, и без этого
 * после такой перезаписи в ходу остался бы прежний ключ — сообщения
 * шифровались бы тем, чего у собеседников уже нет.
 */
const derivedKeys = new Map<string, Promise<CryptoKey>>();

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

async function deriveKeyBits(
  chatKey: Uint8Array,
  chatId: string,
  info: string
): Promise<ArrayBuffer> {
  const salt = await crypto.subtle.digest('SHA-256', utf8ToBytes(chatId));
  const material = await crypto.subtle.importKey('raw', chatKey, 'HKDF', false, ['deriveBits']);

  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8ToBytes(info) },
    material,
    256
  );
}

/**
 * Ключ для одного назначения.
 *
 * `info` включает назначение, поэтому из одного ключа чата получаются
 * независимые ключи: знание одного ничего не говорит о другом.
 */
export async function derivePurposeKey(
  chatKey: Uint8Array,
  chatId: string,
  purpose: TKeyPurpose,
  epoch: number
): Promise<CryptoKey> {
  const cacheKey = `${chatId}|${epoch}|${purpose}|${bytesToBase64(chatKey)}`;
  const cached = derivedKeys.get(cacheKey);
  if (cached) return cached;

  const derived = deriveKeyBits(chatKey, chatId, `${KEY_INFO_PREFIX}${purpose}`).then((bits) =>
    crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  );

  derivedKeys.set(cacheKey, derived);

  return derived;
}

/** Ключ для заворачивания ключа чата. Общий секрет ECDH — на входе. */
export async function deriveWrapKey(
  sharedSecret: Uint8Array,
  chatId: string,
  info: string
): Promise<CryptoKey> {
  const bits = await deriveKeyBits(sharedSecret, chatId, info);
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function forgetDerivedKeys(): void {
  derivedKeys.clear();
}

/**
 * Версия в подпись не входит, поэтому у `v3` она входит в дополнительные
 * данные: иначе сервер мог бы выдать конверт `v3` за `v2`, и получатель
 * увидел бы вместо сообщения сырой JSON. С версией в AAD такая подмена
 * просто не расшифруется. У `v2` данные прежние — старые сообщения читаются.
 */
function messageAad(chatId: string, epoch: number, senderId: string, version: number): Uint8Array {
  const base = `${chatId}|${epoch}|${senderId}`;
  return utf8ToBytes(version === ENVELOPE_VERSION ? base : `${base}|v${version}`);
}

function mediaAad(chatId: string, epoch: number): Uint8Array {
  return utf8ToBytes(`${chatId}|${epoch}`);
}

export function isEnvelopeV2(value: unknown): value is IEnvelopeV2 {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.v === ENVELOPE_VERSION || candidate.v === RICH_ENVELOPE_VERSION) &&
    typeof candidate.epoch === 'number' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.data === 'string'
  );
}

/**
 * Разбор строки из поля `content`.
 *
 * `null` означает, что это не конверт нынешнего формата: обычный текст,
 * заглушка звонка или сообщение прежней схемы.
 */
export function parseEnvelope(content: string): IEnvelopeV2 | null {
  if (!content.startsWith('{')) return null;

  try {
    const parsed: unknown = JSON.parse(content);
    return isEnvelopeV2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Сообщение прежней схемы.
 *
 * Такие не расшифровываются намеренно: в прежнем формате ключ отправителя
 * брался из самого сообщения, и любой, кто мог его записать, мог написать
 * от чужого имени. Читать это — значит показывать человеку то, за
 * подлинность чего никто не отвечает.
 */
export function isLegacyContent(content: string): boolean {
  if (content.startsWith('[MLS]')) return true;
  if (!content.startsWith('{')) return false;

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return (
      parsed.e2e === true && parsed.v !== ENVELOPE_VERSION && parsed.v !== RICH_ENVELOPE_VERSION
    );
  } catch {
    return false;
  }
}

export async function encryptMessage(
  chatKey: Uint8Array,
  chatId: string,
  epoch: number,
  senderId: string,
  text: string,
  signer?: IEnvelopeSigner,
  entities: IMessageEntity[] = []
): Promise<string> {
  const key = await derivePurposeKey(chatKey, chatId, 'msg', epoch);
  const iv = randomIv();
  const version = entities.length > 0 ? RICH_ENVELOPE_VERSION : ENVELOPE_VERSION;
  const plaintext = version === RICH_ENVELOPE_VERSION ? JSON.stringify({ text, entities }) : text;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: messageAad(chatId, epoch, senderId, version) },
    key,
    utf8ToBytes(plaintext)
  );

  const envelope: IEnvelopeV2 = {
    v: version,
    e2e: true,
    epoch,
    iv: bytesToBase64(iv),
    data: bytesToBase64(ciphertext),
  };

  if (signer) {
    envelope.kid = signer.fingerprint;
    envelope.sig = await signer.sign({
      chatId,
      epoch,
      senderId,
      iv: envelope.iv,
      data: envelope.data,
    });
  }

  return JSON.stringify(envelope);
}

/**
 * Текст и форматирование из конверта. У `v2` форматирования нет; у `v3`
 * диапазоны проверяются заново: их не видел никто, кроме отправителя.
 */
export async function decryptMessage(
  chatKey: Uint8Array,
  chatId: string,
  senderId: string,
  envelope: IEnvelopeV2
): Promise<IRichText> {
  const key = await derivePurposeKey(chatKey, chatId, 'msg', envelope.epoch);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(envelope.iv),
      additionalData: messageAad(chatId, envelope.epoch, senderId, envelope.v),
    },
    key,
    base64ToBytes(envelope.data)
  );

  const decoded = bytesToUtf8(plaintext);
  if (envelope.v !== RICH_ENVELOPE_VERSION) return { text: decoded, entities: [] };

  const payload = JSON.parse(decoded) as { text?: unknown; entities?: unknown };
  if (typeof payload.text !== 'string') {
    throw new Error('Конверт v3 без текста');
  }
  return { text: payload.text, entities: normalizeEntities(payload.text, payload.entities) };
}

export async function encryptMediaBytes(
  chatKey: Uint8Array,
  chatId: string,
  epoch: number,
  bytes: ArrayBuffer
): Promise<{ iv: string; ciphertext: string }> {
  const key = await derivePurposeKey(chatKey, chatId, 'media', epoch);
  const iv = randomIv();

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: mediaAad(chatId, epoch) },
    key,
    bytes
  );

  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

export async function decryptMediaBytes(
  chatKey: Uint8Array,
  chatId: string,
  epoch: number,
  iv: string,
  ciphertext: string
): Promise<ArrayBuffer> {
  const key = await derivePurposeKey(chatKey, chatId, 'media', epoch);

  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(iv),
      additionalData: mediaAad(chatId, epoch),
    },
    key,
    base64ToBytes(ciphertext)
  );
}
