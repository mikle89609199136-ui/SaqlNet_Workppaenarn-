import { readKey, writeKey } from './keyStore';

/**
 * Отметки о смене ключа собеседника.
 *
 * Ключ собеседника выдаёт сервер, и подменить его — самый простой способ
 * встать между двумя людьми. Отличить подмену от честной смены устройства
 * технически нельзя: и то и другое выглядит как новая связка ключей.
 * Поэтому решение остаётся за человеком, а приложение обязано о смене
 * сказать — молчание здесь и есть та дыра, ради которой затевалась подмена.
 *
 * Отметка живёт, пока человек её не примет; принятое запоминается на
 * устройстве, иначе одна и та же смена всплывала бы при каждой загрузке.
 */

export interface ISecurityNotice {
  userId: string;
  previousFingerprint: string;
  currentFingerprint: string;
}

const ACKNOWLEDGED_PREFIX = 'peerfp-acked:';

const notices = new Map<string, ISecurityNotice>();
const listeners = new Set<() => void>();

const NO_NOTICE = null;

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Связка собеседника сменилась.
 *
 * Вызывается там, где это становится известно, — при получении связки с
 * сервера. Первая связка сменой не считается: до неё мы о человеке ничего
 * не знали.
 */
export async function noteIdentityChange(
  userId: string,
  previousFingerprint: string,
  currentFingerprint: string
): Promise<void> {
  if (previousFingerprint === currentFingerprint) return;

  const acknowledged = await readKey<string>(`${ACKNOWLEDGED_PREFIX}${userId}`);
  if (acknowledged === currentFingerprint) return;

  notices.set(userId, { userId, previousFingerprint, currentFingerprint });
  announce();
}

/** Человек увидел отметку и принял её. Больше не показываем. */
export async function acknowledgeIdentityChange(userId: string): Promise<void> {
  const notice = notices.get(userId);
  if (!notice) return;

  await writeKey(`${ACKNOWLEDGED_PREFIX}${userId}`, notice.currentFingerprint);
  notices.delete(userId);
  announce();
}

export function readSecurityNotice(userId: string): ISecurityNotice | null {
  return notices.get(userId) ?? NO_NOTICE;
}

/** Первая непринятая отметка среди этих людей. */
export function readFirstSecurityNotice(userIds: string[]): ISecurityNotice | null {
  for (const userId of userIds) {
    const notice = notices.get(userId);
    if (notice) return notice;
  }

  return NO_NOTICE;
}

export function subscribeToSecurityNotices(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Выход из аккаунта: отметки следующего не должны достаться от прежнего. */
export function forgetSecurityNotices(): void {
  notices.clear();
  announce();
}
