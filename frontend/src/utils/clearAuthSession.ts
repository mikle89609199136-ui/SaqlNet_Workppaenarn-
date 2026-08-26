import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { clearMediaObjectUrls } from '@/services/mediaObjectUrls';
import { queryClient } from '@/queries/queryClient';
import { useProfileStore } from '@/store/profile';

export function clearAuthSession() {
  const { token, clearProfile } = useProfileStore.getState();
  if (!token) return;
  disconnectRealtimeSocket();
  // В кеше запросов лежат расшифрованные сообщения. Без очистки они
  // остались бы в памяти вкладки и достались следующему, кто здесь войдёт.
  queryClient.clear();
  // Расшифрованные файлы живут отдельно от кеша запросов: очистка кеша
  // убирает ссылки на них, но саму память браузер держит до отзыва.
  clearMediaObjectUrls();
  clearProfile();
}
