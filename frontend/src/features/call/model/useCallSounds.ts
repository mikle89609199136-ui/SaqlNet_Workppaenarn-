import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '@/shared/api';
import { getNotificationFlags, settingsQuery, userKeys } from '@/entities/user';

/** Effective рингтон: N && C. Профиль/localStorage не разрешают оповещения до GET. */
export function useCallSounds(): boolean {
  const client = useQueryClient();
  useQuery({ ...settingsQuery(), enabled: false });
  useIsMutating({ mutationKey: userKeys.settings() });
  return getNotificationFlags(client).callSounds;
}
export function getCallSoundsEnabled(): boolean {
  return getNotificationFlags(queryClient).callSounds;
}
