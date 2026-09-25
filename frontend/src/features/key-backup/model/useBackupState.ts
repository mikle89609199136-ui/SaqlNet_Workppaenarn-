import { useSyncExternalStore } from 'react';
import { readBackupState, subscribeToBackupState, type IBackupState } from '@/shared/crypto';

/** Состояние резервной копии ключей на этом устройстве. */
export function useBackupState(): IBackupState {
  return useSyncExternalStore(subscribeToBackupState, readBackupState, readBackupState);
}
