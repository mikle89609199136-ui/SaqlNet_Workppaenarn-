import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { useProfileStore } from '@/store/profile';

export function clearAuthSession() {
  const { token, clearProfile } = useProfileStore.getState();
  if (!token) return;
  disconnectRealtimeSocket();
  clearProfile();
}
