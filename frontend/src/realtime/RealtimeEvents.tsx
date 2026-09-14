import { useProfileStore } from '@/entities/user';
import { useServerEvents } from './useServerEvents';

/**
 * Точка подключения событий сервера к кешу запросов.
 *
 * Живёт на уровне приложения и работает, пока есть сессия: подписка
 * не должна зависеть от того, какая страница сейчас открыта.
 */
export function RealtimeEvents() {
  const token = useProfileStore((state) => state.token);

  useServerEvents(Boolean(token));

  return null;
}
