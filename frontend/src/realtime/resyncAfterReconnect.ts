import type { QueryClient } from '@tanstack/react-query';
import {
  captureThreadChanges,
  MESSAGES_PAGE_SIZE,
  putThreadMessages,
  retryAllOutboxMessages,
} from '@/entities/message';
import { chatKeys } from '@/entities/chat';
import { services } from '@/services/serviceContainer';

/**
 * Догнать то, что пришло, пока связи не было.
 *
 * Свежесть ленты целиком держится на сокете: история помечена как никогда
 * не устаревающая, а перезапрос при возврате сети отключён. Стоит
 * соединению моргнуть — и сообщение, пришедшее в эти секунды, не появится
 * в разговоре никогда: ни возврат на страницу, ни переход в соседний чат
 * его не покажут.
 *
 * Поэтому после восстановления связи открытый чат дотягивает свежую
 * страницу и убирает то, что за время обрыва удалили (#1068). Историю
 * закрытых чатов кеш забывает: при открытии она загрузится заново, иначе
 * чат показал бы себя без пропущенного, а счётчик в списке — с ним, и
 * «залип» бы. Закреплённые и данные чатов перечитываются.
 */

/** Чаты, чья история лежит в кеше: открытые сейчас и закрытые недавно. */
function cachedThreads(queryClient: QueryClient, type: 'active' | 'inactive'): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: chatKeys.all, type })
    .map((query) => query.queryKey)
    .filter((key): key is readonly [string, string, string] => key.at(-1) === 'messages')
    .map((key) => String(key[1]));
}

export async function resyncAfterReconnect(queryClient: QueryClient): Promise<void> {
  // Списки перезапрашиваются целиком: за время обрыва могли измениться
  // превью, порядок и счётчики непрочитанных в любом чате, в том числе
  // в архиве.
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  void queryClient.invalidateQueries({ queryKey: chatKeys.archived() });

  const openChats = cachedThreads(queryClient, 'active');
  const closedChats = cachedThreads(queryClient, 'inactive');

  // Удалить, а не пометить устаревшей: устаревшая лента при открытии
  // показалась бы из кеша, а догрузка старых страниц, которую чат
  // запускает сразу, отменила бы фоновый перезапрос — и пропущенное снова
  // не появилось бы.
  for (const chatId of closedChats) {
    queryClient.removeQueries({ queryKey: chatKeys.messages(chatId), exact: true });
  }

  // Закрепления и данные чата события тоже могли пропустить. `exact` у
  // данных чата обязателен: его ключ — префикс ключа истории.
  for (const chatId of [...openChats, ...closedChats]) {
    void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId), exact: true });
  }

  await Promise.all(
    openChats.map(async (chatId) => {
      const changes = captureThreadChanges(queryClient, chatId);
      try {
        // Только свежая страница. Прокрученную вверх историю не трогаем:
        // это десятки запросов и полная перерасшифровка ради сообщений,
        // которые никуда не делись.
        const page = await services.messageService.fetchMessagesPage(chatId, 0, MESSAGES_PAGE_SIZE);

        // Страница обновляет и известные ID: событие правки могло пропасть,
        // а заглушка расшифровки — остаться после появления ключа.
        // Старые страницы сохраняются, новые ID добавляются без дубликатов.
        changes.stop();
        putThreadMessages(queryClient, chatId, page, {
          replaceExisting: true,
          replay: changes.replay,
          dropMissing: true,
        });
      } catch (error) {
        // Связь только вернулась и могла отвалиться снова. Следующее
        // восстановление повторит попытку.
        console.warn('Не удалось догнать пропущенные сообщения', error);
      } finally {
        changes.stop();
      }
    })
  );

  // Переотправляем сообщения из Outbox после того, как догнали пропущенные
  // (чтобы исключить повторную отправку того, что сервер успел сохранить).
  try {
    await retryAllOutboxMessages(queryClient);
  } catch (error) {
    console.warn('Не удалось повторить отправку очереди outbox', error);
  }
}
