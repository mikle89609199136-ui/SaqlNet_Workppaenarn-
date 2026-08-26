import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { WS_EVENTS } from '@/consts';
import type { IWsEventMap } from '@/types';
import { useRealtimeSocket } from '@/hooks/useRealtimeSocket';
import {
  dropPinnedMessage,
  putPinnedMessage,
  putThreadMessage,
} from '@/queries/chat/threadCacheActions';
import { chatKeys } from '@/queries/keys';
import { services } from '@/services/serviceContainer';
import { useTypingStore } from '@/store/typing';
import { IGNORED_EVENTS, INVALIDATION_MAP, resolveInvalidations } from './invalidationMap';

/**
 * Единственный подписчик на события сервера.
 *
 * Раньше каждый компонент подписывался сам, и связь «что пришло — что
 * устарело» существовала только в виде разбросанных обработчиков. Теперь
 * она описана таблицей, а здесь остаётся лишь её применение.
 *
 * Исключение сделано для нового сообщения: инвалидация означала бы поход
 * на сервер и задержку в ленте, поэтому оно кладётся в кеш напрямую.
 */
export function useServerEvents(enabled: boolean): void {
  const queryClient = useQueryClient();
  const { eventBus } = useRealtimeSocket(enabled);
  const setTyping = useTypingStore((state) => state.setTyping);

  useEffect(() => {
    if (!enabled) return undefined;

    const invalidate = (eventType: string, payload: { chatId?: string }) => {
      resolveInvalidations(eventType, payload).forEach((queryKey) => {
        void queryClient.invalidateQueries({ queryKey });
      });
    };

    const unsubscribers = Object.keys(INVALIDATION_MAP).map((eventType) =>
      // Таблица построена из тех же констант, что и карта типов событий,
      // но перебор ключей объекта эту связь теряет.
      eventBus.on(eventType as keyof IWsEventMap, (payload: any) => {
        // Новое сообщение появляется в ленте сразу: расшифровываем и кладём
        // в кеш, а перезапрашиваем только список чатов.
        if (eventType === WS_EVENTS.MESSAGE.NEW && payload?.chatId && payload?.message) {
          void services.messageService
            .processMessageForDisplay(payload.chatId, payload.message)
            .then((message) => {
              putThreadMessage(queryClient, payload.chatId, message);
              // Только список чатов: ключ чата — префикс для его истории,
              // и инвалидация по нему тут же перезапросила бы ленту,
              // затерев только что вставленное сообщение.
              void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
            })
            .catch((error) => {
              // Шина ловит только синхронные исключения, поэтому отказ
              // асинхронного обработчика иначе потерялся бы бесследно.
              console.warn('Не удалось обработать входящее сообщение', error);
              invalidate(eventType, payload);
            });
          return;
        }

        // Закрепление приходит вместе с самим сообщением: расшифровываем
        // и кладём в панель, вместо того чтобы запрашивать список заново.
        if (eventType === WS_EVENTS.MESSAGE.PINNED && payload?.chatId && payload?.pin?.message) {
          void services.messageService
            .processMessageForDisplay(payload.chatId, payload.pin.message)
            .then((message) => {
              putPinnedMessage(queryClient, payload.chatId, { ...payload.pin, message });
            })
            .catch((error) => {
              console.warn('Не удалось обработать закрепление', error);
              invalidate(eventType, payload);
            });
          return;
        }

        if (eventType === WS_EVENTS.MESSAGE.UNPINNED && payload?.chatId && payload?.messageId) {
          dropPinnedMessage(queryClient, payload.chatId, payload.messageId);
          return;
        }

        invalidate(eventType, payload ?? {});
      })
    );

    // «Печатает» живёт три секунды и не кешируется — это не данные,
    // а эфемерное состояние интерфейса.
    const unsubscribeTyping = eventBus.on(WS_EVENTS.USER.TYPING, (event) => {
      const userId = event.userId || event.senderId;
      if (event.chatId && userId) setTyping(event.chatId, userId);
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeTyping();
    };
  }, [enabled, eventBus, queryClient, setTyping]);
}

/** Типы, которые адаптер сознательно пропускает. Экспорт для тестов. */
export { IGNORED_EVENTS };
