import { QueryClient } from '@tanstack/react-query';
import type { IApiError } from './ApiClient';

/** Сколько кеш живёт после того, как перестал использоваться. */
const THIRTY_MINUTES = 30 * 60 * 1000;

function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = (error as IApiError)?.status;

  // Ответ сервера получен и он окончательный: повторять нечего.
  // 401 отдельно обрабатывает ApiClient — он объявляет об истёкшей сессии.
  if (typeof status === 'number' && status < 500) return false;

  return failureCount < 2;
}

/**
 * Общий клиент запросов.
 *
 * ВАЖНО: в кеше лежит **расшифрованный** текст сообщений. Отсюда два запрета,
 * которые нельзя обойти ради удобства:
 *
 * 1. persistQueryClient не подключается никогда — расшифрованная переписка
 *    не должна попадать на диск;
 * 2. инструменты разработчика подключаются только в dev-сборке — иначе
 *    содержимое чужих сообщений видно любому, кто открыл панель.
 *
 * По той же причине `clearAuthSession` очищает кеш при выходе: без этого
 * после смены аккаунта в той же вкладке чужие сообщения остаются в памяти.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Поведение сохраняется прежним: приложение не перезапрашивает данные
      // при возврате во вкладку — свежесть приносит WebSocket.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: shouldRetry,
      gcTime: THIRTY_MINUTES,
    },
    mutations: {
      retry: false,
    },
  },
});
