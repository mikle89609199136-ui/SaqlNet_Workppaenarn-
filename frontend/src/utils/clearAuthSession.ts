import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { queryClient } from '@/queries/queryClient';
import { useProfileStore } from '@/store/profile';

export function clearAuthSession() {
  const { token, clearProfile } = useProfileStore.getState();
  if (!token) return;
  disconnectRealtimeSocket();
  // В кеше запросов лежат расшифрованные сообщения. Без очистки они
  // остались бы в памяти вкладки и достались следующему, кто здесь войдёт.
  queryClient.clear();
  clearProfile();
}
