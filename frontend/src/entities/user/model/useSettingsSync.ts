import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProfileStore } from './profileStore';
import { settingsSession } from './settingsSession';
import { startSettingsSync } from './settingsSync';

export function useSettingsSync(): void {
  const client = useQueryClient();
  const ownerId = useProfileStore((state) => state.user?.id);
  const isAuth = useProfileStore((state) => state.isAuth);
  useEffect(() => {
    if (!ownerId || !isAuth) return;
    return startSettingsSync(client, settingsSession());
  }, [client, ownerId, isAuth]);
}
