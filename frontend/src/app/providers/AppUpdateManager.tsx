import { useEffect } from 'react';
import { useAppUpdateWatcher } from '@/features/app-update';
import { useCallStore } from '@/features/call';
import { holdAppUpdate } from '@/shared/lib';

/**
 * Обновление приложения (#892): проверка новой сборки, пока приложение
 * открыто, и «не перезагружаться посреди звонка». Звонок — отдельная фича,
 * поэтому связь с обновлением ставится здесь, а не в ней.
 */
export function AppUpdateManager() {
  useAppUpdateWatcher();

  const inCall = useCallStore((state) => Boolean(state.activeCall || state.incomingCall));
  useEffect(() => (inCall ? holdAppUpdate('call') : undefined), [inCall]);

  return null;
}
