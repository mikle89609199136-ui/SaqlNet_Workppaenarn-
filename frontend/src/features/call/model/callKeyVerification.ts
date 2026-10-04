import { utf8ToBytes } from '@/shared/crypto';

/**
 * Фиксированный набор из 64 визуально различимых Noto-эмодзи для сверки ключа звонка (#853).
 * Все 64 эмодзи гарантированно присутствуют в статических SVG-ассетах приложения
 * (/emoji/noto/*.svg) и в шрифте Noto Color Emoji.
 *
 * Размер словаря — степень двойки (2^6 = 64), поэтому операция `byte & 0x3f`
 * даёт идеально равномерное распределение вероятностей без остаточного смещения.
 */
export const CALL_VERIFICATION_EMOJIS: readonly string[] = [
  // Смайлы (20)
  '😀', '😂', '🙂', '🙃', '😉', '😇', '😍', '🤩', '😋', '😜',
  '🤔', '😐', '🙄', '😴', '😭', '😡', '🤯', '😱', '🥶', '😎',
  // Жесты (12)
  '👍', '👎', '👌', '✌️', '🤝', '👏', '🙏', '💪', '👀', '👋',
  '🤙', '🫶',
  // Сердца (8)
  '❤️', '💛', '💚', '💙', '💜', '🖤', '💔', '💖',
  // Предметы и символы (24)
  '🎉', '🎁', '🏆', '⚽', '🎮', '🎧', '🎵', '☕', '🍕', '🍰',
  '🍺', '💻', '📱', '📷', '🔑', '💡', '📌', '✅', '❌', '⚡',
  '🔥', '⭐', '🚀', '🎊',
];

/**
 * Извлекает и нормализует отпечаток DTLS из строки SDP.
 * Строка вида: `a=fingerprint:sha-256 4A:AD:B9:...`
 * Возвращает строку вида: `sha-256 4AADB9...`
 */
export function parseDtlsFingerprint(sdp: string | null | undefined): string | null {
  if (!sdp || typeof sdp !== 'string') {
    return null;
  }

  const match = sdp.match(/(?:^|\r?\n)a=fingerprint:\s*([^\s]+)\s+([0-9a-fA-F: ]+)/i);
  if (!match) {
    return null;
  }

  const algorithm = match[1].trim().toLowerCase();
  const fingerprintHex = match[2].replace(/[:\s]/g, '').toUpperCase();

  if (!algorithm || !fingerprintHex) {
    return null;
  }

  return `${algorithm} ${fingerprintHex}`;
}

/**
 * Вычисляет 4 проверочных эмодзи из DTLS-отпечатков обоих участников (#853).
 *
 * 1. Извлекает отпечатки из localDescription и remoteDescription.
 * 2. Лексикографически упорядочивает их для симметрии (у caller и callee результат одинаковый).
 * 3. Хеширует объединённую строку через SHA-256.
 * 4. Преобразует первые 4 байта хеша в 4 эмодзи из словаря `CALL_VERIFICATION_EMOJIS`.
 */
export async function computeCallVerificationEmojis(
  localSdp: string | null | undefined,
  remoteSdp: string | null | undefined
): Promise<string[] | null> {
  if (!globalThis.crypto?.subtle) {
    return null;
  }

  const localFp = parseDtlsFingerprint(localSdp);
  const remoteFp = parseDtlsFingerprint(remoteSdp);

  if (!localFp || !remoteFp) {
    return null;
  }

  // Симметричная сортировка: отпечатки упорядочиваются независимо от того,
  // кто является локальным, а кто удалённым участником соединения.
  const sorted = [localFp, remoteFp].sort();
  const combined = `${sorted[0]}\n${sorted[1]}`;

  try {
    const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', utf8ToBytes(combined));
    const hashBytes = new Uint8Array(digestBuffer);

    return [
      CALL_VERIFICATION_EMOJIS[hashBytes[0] & 0x3f],
      CALL_VERIFICATION_EMOJIS[hashBytes[1] & 0x3f],
      CALL_VERIFICATION_EMOJIS[hashBytes[2] & 0x3f],
      CALL_VERIFICATION_EMOJIS[hashBytes[3] & 0x3f],
    ];
  } catch {
    return null;
  }
}
