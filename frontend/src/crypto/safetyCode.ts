import { base64ToBytes } from './encoding';

/**
 * Код безопасности — отпечаток связки ключей в читаемом виде.
 *
 * Он существует ради одного действия: двое сверяют его любым другим
 * способом — голосом, при встрече, в другом мессенджере. Совпал — значит
 * между ними никто не встал. Не совпал — значит ключ подменили, и все
 * прочие проверки бесполезны, потому что ключ собеседника выдаёт сервер.
 *
 * Поэтому вид у него не декоративный: шестнадцатеричные знаки читаются
 * вслух без путаницы, а разбиение на группы позволяет не потерять место.
 */

const GROUPS = 8;
const GROUP_LENGTH = 4;

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
}

/**
 * Отпечаток в виде восьми групп по четыре знака.
 *
 * Берётся начало отпечатка: шестнадцати байт хватает, чтобы подобрать
 * совпадение было невозможно, а читать вслух — всё ещё посильно.
 */
export function safetyCodeFromFingerprint(fingerprint: string): string | null {
  try {
    const bytes = base64UrlToBytes(fingerprint);
    if (bytes.length < (GROUPS * GROUP_LENGTH) / 2) return null;

    const hex = [...bytes.subarray(0, (GROUPS * GROUP_LENGTH) / 2)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    return (hex.match(new RegExp(`.{1,${GROUP_LENGTH}}`, 'g')) ?? []).join(' ');
  } catch {
    return null;
  }
}
