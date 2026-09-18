import {
  readFirstSecurityNotice,
  subscribeToSecurityNotices,
  type ISecurityNotice,
} from '@/crypto/securityNotices';
import { useSyncExternalStore } from 'react';

/**
 * Непринятая отметка о смене ключа у кого-то из этих людей.
 *
 * Подписан на неё только тот, кто её показывает: приход сообщений и набор
 * текста ничего лишнего не перерисовывают.
 */
export function useSecurityNotice(userIds: string[]): ISecurityNotice | null {
  return useSyncExternalStore(
    subscribeToSecurityNotices,
    () => readFirstSecurityNotice(userIds),
    () => readFirstSecurityNotice(userIds)
  );
}
