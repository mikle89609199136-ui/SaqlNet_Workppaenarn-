import type { QueryClient } from '@tanstack/react-query';
import { putThreadMessage } from '@/queries/chat/threadCacheActions';
import { MESSAGES_PAGE_SIZE } from '@/queries/chat/threadQueries';
import { chatKeys } from '@/queries/keys';
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
      try {
        // Только свежая страница. Прокрученную вверх историю не трогаем:
        // это десятки запросов и полная перерасшифровка ради сообщений,
        // которые никуда не делись.
        const page = await services.messageService.fetchMessagesPage(chatId, 0, MESSAGES_PAGE_SIZE);

        // Уже известные сообщения отсеются: запись в ленту различает их по
        // идентификатору. Порядок восстановится при чтении.
        page.forEach((message) => putThreadMessage(queryClient, chatId, message));
      } catch (error) {
        // Связь только вернулась и могла отвалиться снова. Следующее
        // восстановление повторит попытку.
        console.warn('Не удалось догнать пропущенные сообщения', error);
      }
    })
  );
}
