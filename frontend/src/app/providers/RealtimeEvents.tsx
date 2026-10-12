import { useProfileStore } from '@/entities/user';
import { useServerEvents } from '@/realtime/useServerEvents';

/**
 * Точка подключения событий сервера к кешу запросов.
 *
 * Живёт на уровне приложения и работает, пока есть сессия: подписка
 * не должна зависеть от того, какая страница сейчас открыта.
 */
export function RealtimeEvents() {
  const signedIn = useProfileStore((state) => state.isAuth);

  useServerEvents(signedIn);

  return null;
}
