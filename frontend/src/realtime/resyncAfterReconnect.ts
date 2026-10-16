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
 * страницу.
 */

/** Открытые чаты — те, чью историю сейчас кто-то показывает. */
function openChatIds(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: chatKeys.all, type: 'active' })
    .map((query) => query.queryKey)
    .filter((key): key is readonly [string, string, string] => key.at(-1) === 'messages')
    .map((key) => String(key[1]));
}

export async function resyncAfterReconnect(queryClient: QueryClient): Promise<void> {
  // Список чатов перезапрашивается целиком: за время обрыва могли
  // измениться превью, порядок и счётчики непрочитанных в любом из них.
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() });

  await Promise.all(
    openChatIds(queryClient).map(async (chatId) => {
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
