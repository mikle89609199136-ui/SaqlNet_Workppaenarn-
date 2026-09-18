import { base64ToBytes, bytesToBase64, utf8ToBytes } from './encoding';

/**
 * Подпись сообщения.
 *
 * Шифрование скрывает содержимое, но само по себе не говорит, кто его
 * написал. В групповом чате ключ есть у каждого участника — значит любой
 * из них может собрать сообщение от чужого имени и оно расшифруется как
 * настоящее. То же может сделать всякий, кто способен записать сообщение
 * в базу.
 *
 * Подпись это закрывает: она делается приватным ключом отправителя,
 * которого нет ни у сервера, ни у других участников.
 *
 * Подписывается не текст, а всё, что определяет смысл сообщения: чат,
 * эпоха, автор и сам шифртекст. Переставить шифртекст в другой чат или
 * приписать другому человеку, сохранив подпись, нельзя.
 */

const SIGNING_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface ISignedParts {
  chatId: string;
  epoch: number;
  senderId: string;
  iv: string;
  data: string;
}

function canonical({ chatId, epoch, senderId, iv, data }: ISignedParts): Uint8Array {
  return utf8ToBytes(`${chatId}|${epoch}|${senderId}|${iv}|${data}`);
}

export async function signParts(privateKey: CryptoKey, parts: ISignedParts): Promise<string> {
  const signature = await crypto.subtle.sign(SIGNING_ALGORITHM, privateKey, canonical(parts));
  return bytesToBase64(signature);
}

export async function verifyParts(
  publicKey: CryptoKey,
  parts: ISignedParts,
  signature: string
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      SIGNING_ALGORITHM,
      publicKey,
      base64ToBytes(signature),
      canonical(parts)
    );
  } catch {
    // Подпись может быть не base64 или не той длины — это тоже «не сошлась».
    return false;
  }
}
