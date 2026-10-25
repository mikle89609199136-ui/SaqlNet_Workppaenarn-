import type { QueryClient } from '@tanstack/react-query';
import { retryAllOutboxMessages } from '@/entities/message';

/**
 * Дослать неотправленное, когда вернулась сеть или вкладка (#1069).
 *
 * Прежде очередь повторялась только после переподключения сокета. Если
 * сокет не рвался, а упал сам запрос отправки — сеть моргнула, сервер
 * ответил 502, — сообщение так и оставалось «Не отправлено», хотя плашка
 * обещала: уйдёт, когда появится сеть.
 *
 * Лимит попыток и пауза между ними прежние: серверной идемпотентности
 * отправки нет, и каждая лишняя попытка — риск дубля. Транспорт о
 * сообщениях не знает, поэтому это не в WebSocketClient.
 */
export function startOutboxWakeRetry(queryClient: QueryClient): () => void {
  const retry = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    retryAllOutboxMessages(queryClient).catch((error) => {
      console.warn('Не удалось повторить отправку очереди outbox', error);
    });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') retry();
  };

  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('online', retry);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
