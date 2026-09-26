import { base64ToBytes, bytesToBase64, bytesToBase64Url, utf8ToBytes } from './encoding';
import type { IQrPayload } from './qrLink';

/**
 * Вход по коду, который показывает вошедшее устройство (#754).
 *
 * Обратное направление к `qrLink.ts`: там код показывает новое устройство,
 * здесь — вошедшее, а новое сканирует. В ссылке
 * `https://<приложение>/qr-login#t=<токен>&k=<ключ>&s=<ключ подписи>` три
 * вещи, и две последние на сервер не уходят — они после `#`:
 *
 * - `k` — одноразовый публичный ключ вошедшего устройства. Под общий с ним
 *   секрет шифруется мастер-ключ, и из него же считается код сверки;
 * - `s` — ключ подписи. Новое устройство подписывает им свой публичный
 *   ключ: ключ идёт через сервер, и без подписи сервер мог бы подменить
 *   его своим и получить ключ от истории.
 *
 * Код сверки — четыре цифры из общего секрета на обоих экранах. Он ловит
 * случай, который подпись не ловит: код сфотографировали через плечо и
 * отсканировали раньше владельца. Цифры тогда есть только на чужом экране.
 */

const ECDH: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };
const HMAC: HmacImportParams = { name: 'HMAC', hash: 'SHA-256' };
const OFFER_PATH = '/qr-login';
const CONTEXT = 'craneapp/qr-offer/v1';

export interface IQrOfferLink {
  token: string;
  /** Публичный ключ вошедшего устройства, base64url SPKI. */
  publicKey: string;
  /** Ключ подписи, base64url. */
  macKey: string;
}

export function buildQrOfferLink(origin: string, link: IQrOfferLink): string {
  const fragment = new URLSearchParams({
    t: link.token,
    k: link.publicKey,
    s: link.macKey,
  }).toString();
  return `${origin.replace(/\/+$/, '')}${OFFER_PATH}#${fragment}`;
}

/** Разбор ссылки из кода. Принимается только своя страница `/qr-login`. */
export function parseQrOfferLink(text: string, expectedOrigin?: string): IQrOfferLink | null {
  try {
    const url = new URL(text.trim());
    if (url.pathname !== OFFER_PATH) return null;
    if (expectedOrigin && url.origin !== expectedOrigin) return null;

    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    const token = params.get('t') ?? '';
    const publicKey = params.get('k') ?? '';
    const macKey = params.get('s') ?? '';

    return /^[0-9a-f]{32}$/.test(token) &&
      /^[A-Za-z0-9_-]{80,200}$/.test(publicKey) &&
      /^[A-Za-z0-9_-]{43}$/.test(macKey)
      ? { token, publicKey, macKey }
      : null;
  } catch {
    return null;
  }
}

/** Разбор фрагмента открытой страницы `/qr-login`. */
export function parseQrOfferFragment(hash: string): IQrOfferLink | null {
  return parseQrOfferLink(
    `https://link.invalid${OFFER_PATH}${hash.startsWith('#') ? hash : `#${hash}`}`
  );
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function importPublicKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64UrlToBytes(value), ECDH, false, []);
}

function importMacKey(macKey: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(macKey), HMAC, false, [usage]);
}

/** Что подписывает новое устройство: токен кода и свой ключ. */
function claimMessage(token: string, claimPublicKey: string) {
  return utf8ToBytes(`${CONTEXT}|${token}|${claimPublicKey}`);
}

/** Общий секрет двух одноразовых пар и всё, что из него выводится. */
async function sharedSecret(privateKey: CryptoKey, publicKey: CryptoKey, token: string) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, [
    'deriveKey',
    'deriveBits',
  ]);
  const hkdf = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(32),
    // Токен в info привязывает всё к этому входу.
    info: utf8ToBytes(`${info}|${token}`),
  });

  return {
    key: () =>
      crypto.subtle.deriveKey(hkdf(CONTEXT), base, { name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]),
    async verificationCode(): Promise<string> {
      const code = await crypto.subtle.deriveBits(hkdf(`${CONTEXT}/sas`), base, 32);
      return String(new DataView(code).getUint32(0) % 10_000).padStart(4, '0');
    },
  };
}

export interface IQrOffer {
  publicKey: string;
  macKey: string;
  /** Подписан ли ключ нового устройства ключом из кода. */
  verifyClaim(token: string, claimPublicKey: string, mac: string): Promise<boolean>;
  verificationCode(token: string, claimPublicKey: string): Promise<string>;
  /** Мастер-ключ, зашифрованный под ключ нового устройства. */
  seal(
    token: string,
    claimPublicKey: string,
    masterKey: Uint8Array<ArrayBuffer>
  ): Promise<IQrPayload>;
}

/** Вошедшее устройство: одноразовая пара и ключ подписи для кода. */
export async function createQrOffer(): Promise<IQrOffer> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const publicKeyBytes = await crypto.subtle.exportKey('spki', pair.publicKey);
  const macKey = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  const secretWith = async (token: string, claimPublicKey: string) =>
    sharedSecret(pair.privateKey, await importPublicKey(claimPublicKey), token);

  return {
    publicKey: bytesToBase64Url(publicKeyBytes),
    macKey,
    async verifyClaim(token, claimPublicKey, mac) {
      try {
        return await crypto.subtle.verify(
          'HMAC',
          await importMacKey(macKey, 'verify'),
          base64UrlToBytes(mac),
          claimMessage(token, claimPublicKey)
        );
      } catch {
        return false;
      }
    },
    async verificationCode(token, claimPublicKey) {
      return (await secretWith(token, claimPublicKey)).verificationCode();
    },
    async seal(token, claimPublicKey, masterKey) {
      const key = await (await secretWith(token, claimPublicKey)).key();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, masterKey);

      return {
        senderPublicKey: bytesToBase64(publicKeyBytes),
        iv: bytesToBase64(iv),
        ct: bytesToBase64(ct),
      };
    },
  };
}

export interface IQrClaim {
  publicKey: string;
  mac: string;
  verificationCode(): Promise<string>;
  open(payload: IQrPayload): Promise<Uint8Array<ArrayBuffer>>;
}

/** Новое устройство: своя одноразовая пара, подписанная ключом из кода. */
export async function createQrClaim(link: IQrOfferLink): Promise<IQrClaim> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const publicKey = bytesToBase64Url(await crypto.subtle.exportKey('spki', pair.publicKey));
  const mac = bytesToBase64Url(
    await crypto.subtle.sign(
      'HMAC',
      await importMacKey(link.macKey, 'sign'),
      claimMessage(link.token, publicKey)
    )
  );
  // Ключ вошедшего устройства берём из кода, а не из ответа сервера.
  const secret = await sharedSecret(
    pair.privateKey,
    await importPublicKey(link.publicKey),
    link.token
  );

  return {
    publicKey,
    mac,
    async verificationCode() {
      return secret.verificationCode();
    },
    async open(payload) {
      if (
        bytesToBase64(base64ToBytes(payload.senderPublicKey)) !==
        bytesToBase64(base64UrlToBytes(link.publicKey))
      ) {
        throw new Error('Ключ прислало не то устройство, что показало код');
      }
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
        await secret.key(),
        base64ToBytes(payload.ct)
      );
      return new Uint8Array(plaintext);
    },
  };
}
