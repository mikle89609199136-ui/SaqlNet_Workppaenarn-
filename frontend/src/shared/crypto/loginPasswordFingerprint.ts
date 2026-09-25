import { bytesToBase64, utf8ToBytes } from './encoding';

/**
 * Облачный пароль не должен совпадать с паролем входа.
 *
 * Пароль входа сервер получает при каждом логине. Совпади они — сервер
 * мог бы открыть резервную копию, и сквозное шифрование перестало бы быть
 * сквозным. Поэтому при входе запоминаем отпечаток пароля — только в
 * памяти вкладки и ненадолго, — а экран облачного пароля сверяется с ним.
 */

const TTL_MS = 30 * 60 * 1000;

let remembered: { digest: string; at: number } | null = null;

async function digestOf(password: string): Promise<string> {
  return bytesToBase64(await crypto.subtle.digest('SHA-256', utf8ToBytes(password)));
}

export async function rememberLoginPassword(password: string): Promise<void> {
  if (!globalThis.crypto?.subtle) return;
  remembered = { digest: await digestOf(password), at: Date.now() };
}

/** `false` и тогда, когда сверять не с чем: сессию восстановили без ввода пароля. */
export async function matchesLoginPassword(candidate: string): Promise<boolean> {
  if (!remembered || Date.now() - remembered.at > TTL_MS) return false;
  return (await digestOf(candidate)) === remembered.digest;
}

export function forgetLoginPassword(): void {
  remembered = null;
}
