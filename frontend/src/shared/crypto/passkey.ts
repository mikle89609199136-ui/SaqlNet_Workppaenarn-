import { base64ToBytes, bytesToBase64Url, utf8ToBytes } from './encoding';
import type { IPasskeySlot } from './keyBackup';

/**
 * Passkey как запасной ключ к резервной копии (#746).
 *
 * Расширение WebAuthn PRF отдаёт секрет, который аутентификатор выводит
 * из своего ключа и нашей соли. Повторить его может только тот же passkey —
 * а он синхронизируется между устройствами человека через iCloud Keychain,
 * Google Password Manager или Windows Hello. Сервер WebAuthn не проверяет:
 * ему нечего проверять, секрет до него не доходит.
 *
 * Идентификатор сайта (`rp.id`) — домен страницы. IP-адресом он быть не
 * может, поэтому локально passkey работает на `localhost`, но не на
 * `127.0.0.1`.
 */

export interface IPasskeyRegistration {
  credentialId: string;
  prfSalt: Uint8Array<ArrayBuffer>;
  prfOutput: Uint8Array<ArrayBuffer>;
}

interface IPrfResults {
  prf?: { enabled?: boolean; results?: { first?: BufferSource } };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function toBytes(source: BufferSource): Uint8Array<ArrayBuffer> {
  return source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

/** Есть ли в браузере WebAuthn вообще. PRF выясняется только попыткой. */
export function isPasskeyAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    Boolean(navigator.credentials?.create) &&
    // У WebAuthn идентификатор сайта не может быть IP-адресом.
    !/^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname)
  );
}

/** Поддерживает ли браузер PRF. `null` — не знает, пока не попробуешь. */
export async function isPrfSupported(): Promise<boolean | null> {
  if (!isPasskeyAvailable()) return false;

  const getCapabilities = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    }
  ).getClientCapabilities;

  if (!getCapabilities) return null;

  try {
    const capabilities = await getCapabilities();
    return capabilities['extension:prf'] ?? null;
  } catch {
    return null;
  }
}

export class PasskeyPrfUnsupportedError extends Error {
  constructor() {
    super('Этот passkey не умеет выдавать секрет для шифрования (PRF)');
    this.name = 'PasskeyPrfUnsupportedError';
  }
}

/**
 * Passkey ничего не дал: окно закрыли, время вышло или подходящего passkey
 * здесь нет — например, он сохранён в другом браузере. Причину браузер
 * намеренно не называет (`NotAllowedError`), различить их нельзя.
 */
export class PasskeyCancelledError extends Error {
  constructor() {
    super('Passkey не использован');
    this.name = 'PasskeyCancelledError';
  }
}

/** Адрес страницы не годится для passkey — например, открыта по IP. */
export class PasskeyNotAllowedHereError extends Error {
  constructor() {
    super('Passkey недоступен на этом адресе');
    this.name = 'PasskeyNotAllowedHereError';
  }
}

/**
 * Вызов WebAuthn с понятными ошибками вместо браузерных. Текст
 * `DOMException` — английский и для разработчика, человеку его не показать.
 */
async function webAuthn(request: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await request();
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCancelledError();
    if (name === 'SecurityError') throw new PasskeyNotAllowedHereError();
    throw error;
  }
  if (!credential) throw new PasskeyCancelledError();
  return credential as PublicKeyCredential;
}

async function evaluate(
  allow: { credentialId: string; prfSalt: Uint8Array<ArrayBuffer> }[]
): Promise<{ credentialId: string; prfOutput: Uint8Array<ArrayBuffer> }> {
  const assertion = await webAuthn(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        userVerification: 'required',
        allowCredentials: allow.map(({ credentialId }) => ({
          type: 'public-key' as const,
          id: base64UrlToBytes(credentialId),
        })),
        extensions: {
          prf: {
            evalByCredential: Object.fromEntries(
              allow.map(({ credentialId, prfSalt }) => [credentialId, { first: prfSalt }])
            ),
          },
        } as AuthenticationExtensionsClientInputs,
      },
    })
  );

  const results = (assertion.getClientExtensionResults() as IPrfResults).prf?.results?.first;
  if (!results) throw new PasskeyPrfUnsupportedError();

  return { credentialId: bytesToBase64Url(assertion.rawId), prfOutput: toBytes(results) };
}

/**
 * Создать passkey и получить его секрет.
 *
 * Часть аутентификаторов отдаёт секрет прямо при создании, часть — только
 * при входе: тогда сразу же спрашиваем ещё раз.
 */
export async function registerPasskey(user: {
  id: string;
  username: string;
  displayName: string;
}): Promise<IPasskeyRegistration> {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  const credential = await webAuthn(() =>
    navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { id: window.location.hostname, name: 'CraneApp' },
        user: {
          id: utf8ToBytes(user.id),
          name: user.username,
          displayName: user.displayName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })
  );

  const credentialId = bytesToBase64Url(credential.rawId);
  const prf = (credential.getClientExtensionResults() as IPrfResults).prf;

  if (prf?.enabled === false) throw new PasskeyPrfUnsupportedError();

  const immediate = prf?.results?.first;
  if (immediate) return { credentialId, prfSalt, prfOutput: toBytes(immediate) };

  const { prfOutput } = await evaluate([{ credentialId, prfSalt }]);
  return { credentialId, prfSalt, prfOutput };
}

/** Спросить секрет у любого из passkey копии. */
export function evaluatePasskeySlots(
  slots: IPasskeySlot[]
): Promise<{ credentialId: string; prfOutput: Uint8Array<ArrayBuffer> }> {
  return evaluate(
    slots.map((slot) => ({ credentialId: slot.credentialId, prfSalt: base64ToBytes(slot.prfSalt) }))
  );
}
