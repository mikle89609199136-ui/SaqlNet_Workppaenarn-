import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { WS_EVENTS } from '@/shared/config';
import type { IWsEventMap } from '@/types';
import { useRealtimeSocket } from '@/shared/api';
import {
  dropPinnedMessage,
  isReactionChangePending,
  patchThreadMessage,
  putPinnedMessage,
  putThreadMessage,
} from '@/entities/message';
import { useTypingStore, resolveChat } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { startConnectionWatch } from './connectionStatus';
import { IGNORED_EVENTS, INVALIDATION_MAP, resolveInvalidations } from './invalidationMap';
import { resyncAfterReconnect } from './resyncAfterReconnect';

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
        // в кеш, вместо того чтобы запрашивать историю заново.
        if (eventType === WS_EVENTS.MESSAGE.NEW && payload?.chatId && payload?.message) {
          void services.messageService
            .processMessageForDisplay(payload.chatId, payload.message)
            // Превью в списке чатов обновит сама запись в ленту: правило
            // «изменилась лента — устарело превью» живёт в одном месте.
            .then((message) => putThreadMessage(queryClient, payload.chatId, message))
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

        /* Реакции приходят в самом событии — их достаточно положить в
           нужное сообщение. Прежде здесь помечалась устаревшей вся
           история чата: чужой лайк в переписке на пятьсот сообщений
           перекачивал её целиком, а своя реакция успевала мигнуть, пока
           лента ходила на сервер. */
        if (
          eventType === WS_EVENTS.REACTIONS.REACTION_UPDATED &&
          payload?.chatId &&
          payload?.messageId
        ) {
          // Своя же операция ещё идёт — её промежуточные состояния
          // показывать нельзя, окончательное принесёт наш ответ.
          if (!isReactionChangePending(payload.messageId)) {
            patchThreadMessage(queryClient, payload.chatId, payload.messageId, {
              reactions: payload.reactions ?? [],
            });
          }
          return;
        }

        if (eventType === WS_EVENTS.MESSAGE.UNPINNED && payload?.chatId && payload?.messageId) {
          dropPinnedMessage(queryClient, payload.chatId, payload.messageId);
          return;
        }

        invalidate(eventType, payload ?? {});
      })
    );

    // Восстановление связи. Пока её не было, сообщения приходили в
    // пустоту: свежесть ленты держится на сокете, а перезапрос при
    // возврате сети отключён намеренно. Без этого пропущенное не
    // появилось бы в разговоре никогда.
    const unsubscribeReconnect = eventBus.on(WS_EVENTS.SOCKET.CONNECTED, () => {
      void resyncAfterReconnect(queryClient);
    });

    // Состав чата изменился — ключ чата пора менять: вошедший не должен
    // читать написанное до него, вышедший — написанное после.
    //
    // Ротацию делает только владелец чата. Если бы её начинал каждый, кто
    // услышал событие, несколько участников одновременно записали бы разные
    // ключи одной эпохи, и часть чата осталась бы с чужим ключом: запись на
    // сервере идёт построчно, без транзакции.
    const rotateIfOwner = async (chatId?: string) => {
      if (!chatId) return;

      try {
        const chat = await resolveChat(chatId);
        const me = services.cryptoService.getAccountId();

        if (chat?.ownerId && me && chat.ownerId === me) {
          await services.cryptoService.rotateChatKey(chatId);
        }
      } catch (error) {
        console.warn('Не удалось обновить ключ чата после смены состава', error);
      }
    };

    const unsubscribeMemberAdded = eventBus.on(WS_EVENTS.CHAT.MEMBER_ADDED, (event) => {
      void rotateIfOwner(event?.chatId);
    });

    const unsubscribeMemberRemoved = eventBus.on(WS_EVENTS.CHAT.MEMBER_REMOVED, (event) => {
      void rotateIfOwner(event?.chatId);
    });

    // «Печатает» живёт три секунды и не кешируется — это не данные,
    // а эфемерное состояние интерфейса.
    const unsubscribeTyping = eventBus.on(WS_EVENTS.USER.TYPING, (event) => {
      const userId = event.userId || event.senderId;
      if (event.chatId && userId) setTyping(event.chatId, userId);
    });

    // Состояние связи отслеживается здесь, а не там, где показывается:
    // обрыв случается и на экране без индикатора.
    const stopConnectionWatch = startConnectionWatch();

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeTyping();
      unsubscribeReconnect();
      unsubscribeMemberAdded();
      unsubscribeMemberRemoved();
      stopConnectionWatch();
    };
  }, [enabled, eventBus, queryClient, setTyping]);
}

/** Типы, которые адаптер сознательно пропускает. Экспорт для тестов. */
export { IGNORED_EVENTS };
