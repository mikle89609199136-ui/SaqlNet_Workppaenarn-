import {
  readConnectionStatus,
  subscribeToConnectionStatus,
  type TConnectionStatus,
} from '@/realtime/connectionStatus';
import { useSyncExternalStore } from 'react';

/**
 * Состояние связи. Перерисовывается только тот, кто его показывает, и
 * только когда оно меняется — не чаще одного раза на обрыв.
 */
export function useConnectionStatus(): TConnectionStatus {
  return useSyncExternalStore(
    subscribeToConnectionStatus,
    readConnectionStatus,
    readConnectionStatus
  );
}
