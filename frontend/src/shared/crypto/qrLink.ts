import { base64ToBytes, bytesToBase64, bytesToBase64Url, utf8ToBytes } from './encoding';

/**
 * Передача мастер-ключа копии на новое устройство по QR (#745).
 *
 * Новое устройство создаёт одноразовую пару ECDH и показывает QR со
 * ссылкой `https://<приложение>/link#t=<токен>&k=<публичный ключ>`.
 * Камера телефона открывает приложение прямо на подтверждении. Токен и
 * ключ стоят после `#`: эту часть браузер на сервер не отправляет, в логи
 * и Referer она не попадает.
 *
 * Публичный ключ доходит до вошедшего устройства оптически, мимо сервера,
 * поэтому подменить его сервер не может, — а значит, не может и прочитать
 * мастер-ключ, зашифрованный под него.
 */

const ECDH: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };
const LINK_PATH = '/link';

export interface IQrLink {
  token: string;
  publicKey: string;
}

export interface IQrPayload {
  senderPublicKey: string;
  iv: string;
  ct: string;
}

export function buildQrLink(origin: string, link: IQrLink): string {
  const fragment = new URLSearchParams({ t: link.token, k: link.publicKey }).toString();
  return `${origin.replace(/\/+$/, '')}${LINK_PATH}#${fragment}`;
}

/**
 * Разбор ссылки из QR или вставленной руками.
 *
 * Принимается только своя страница `/link`: код с чужой ссылкой — не наш,
 * и подтверждать по нему нечего.
 */
export function parseQrLink(text: string, expectedOrigin?: string): IQrLink | null {
  try {
    const url = new URL(text.trim());
    if (url.pathname !== LINK_PATH) return null;
    if (expectedOrigin && url.origin !== expectedOrigin) return null;

    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    const token = params.get('t') ?? '';
    const publicKey = params.get('k') ?? '';

    return /^[0-9a-f]{32}$/.test(token) && /^[A-Za-z0-9_-]{80,200}$/.test(publicKey)
      ? { token, publicKey }
      : null;
  } catch {
    return null;
  }
}

/** Разбор фрагмента текущей страницы `/link`. */
export function parseQrFragment(hash: string): IQrLink | null {
  return parseQrLink(`https://link.invalid${LINK_PATH}${hash.startsWith('#') ? hash : `#${hash}`}`);
}

export interface IQrReceiver {
  publicKey: string;
  open(payload: IQrPayload, token: string): Promise<Uint8Array<ArrayBuffer>>;
}

async function sharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  token: string
): Promise<CryptoKey> {
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      // Токен в info привязывает шифровку к этому входу: переложить её в
      // другой запрос не выйдет.
      info: utf8ToBytes(`craneapp/qr-link/v1|${token}`),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/** Новое устройство: одноразовая пара, которая расшифрует присланное. */
export async function createQrReceiver(): Promise<IQrReceiver> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const publicKey = bytesToBase64Url(await crypto.subtle.exportKey('spki', pair.publicKey));

  return {
    publicKey,
    async open(payload, token) {
      const sender = await crypto.subtle.importKey(
        'spki',
        base64ToBytes(payload.senderPublicKey),
        ECDH,
        false,
        []
      );
      const key = await sharedKey(pair.privateKey, sender, token);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
        key,
        base64ToBytes(payload.ct)
      );

      return new Uint8Array(plaintext);
    },
  };
}

/** Вошедшее устройство: зашифровать мастер-ключ под ключ из QR. */
export async function sealForQrReceiver(
  link: IQrLink,
  masterKey: Uint8Array<ArrayBuffer>
): Promise<IQrPayload> {
  const receiver = await crypto.subtle.importKey(
    'spki',
    base64UrlToBytes(link.publicKey),
    ECDH,
    false,
    []
  );
  const sender = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const key = await sharedKey(sender.privateKey, receiver, link.token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, masterKey);

  return {
    senderPublicKey: bytesToBase64(await crypto.subtle.exportKey('spki', sender.publicKey)),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
}
