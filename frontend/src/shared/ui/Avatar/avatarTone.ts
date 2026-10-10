/* Тот же хеш, что был в Identicon: он уже разложен по чужим аватаркам,
   и менять его значит перекрасить всех разом без причины. */
export function hashBytes(value: string) {
  const bytes = new Uint8Array(16);
  let seed = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    seed ^= value.charCodeAt(i);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }

  for (let i = 0; i < 16; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes[i] = (seed >>> 24) & 0xff;
  }

  return bytes;
}

const TONE_COUNT = 6;

export const avatarToneIndex = (bytes: Uint8Array) => bytes[0] % TONE_COUNT;

export const avatarColor = (seed: string) =>
  `var(--color-av-${avatarToneIndex(hashBytes(seed || 'anon')) + 1})`;
