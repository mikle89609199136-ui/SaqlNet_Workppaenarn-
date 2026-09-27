/**
 * Перевод между байтами, base64 и текстом.
 *
 * Отдельным файлом, потому что этим пользуется всё шифрование, а ошибка
 * здесь выглядит как ошибка криптографии: сообщение просто не
 * расшифровывается, и причину ищут не там.
 */

/** Больше — и `String.fromCharCode` упирается в предел числа аргументов. */
const CHUNK_SIZE = 0x8000;

export function bytesToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * base64url без выравнивания.
 *
 * Отпечаток ключа попадает в поле `keyId`, а оттуда — в URL и в интерфейс;
 * `+`, `/` и `=` там неуместны.
 */
export function bytesToBase64Url(input: ArrayBuffer | Uint8Array): string {
  return bytesToBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function utf8ToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
