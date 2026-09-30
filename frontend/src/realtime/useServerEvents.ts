import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { WS_EVENTS } from '@/shared/config';
import type { IWsEventMap } from '@/types';
import { useRealtimeSocket } from '@/shared/api';
import {
  dropPinnedMessage,
  dropThreadMessages,
  isReactionChangePending,
  patchThreadMessage,
  putPinnedMessage,
  putThreadMessage,
  putThreadReceipt,
} from '@/entities/message';
import { putChatListReceipt, useTypingStore } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { createPresenceBuffer, refreshPresence } from './applyPresence';
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
/** Не чаще — перечитывание статусов при возврате во вкладку. */
const PRESENCE_REFRESH_MS = 30_000;

export function useServerEvents(enabled: boolean): void {
  const queryClient = useQueryClient();
  const { eventBus } = useRealtimeSocket(enabled);
  const setTyping = useTypingStore((state) => state.setTyping);
  const clearTyping = useTypingStore((state) => state.clearTyping);

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
          // Сообщение пришло — автор больше не печатает: не ждём три
          // секунды таймера над его же сообщением (#837).
          if (payload.message.senderId) clearTyping(payload.chatId, payload.message.senderId);
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

        // Пачка удалена у всех или скрыта у себя (#840): убираем из ленты на
        // месте, без перезапроса истории. Своё устройство, которое удаляло,
        // получает то же событие — повторное удаление ничего не меняет.
        if (
          (eventType === WS_EVENTS.MESSAGE.BATCH_DELETED ||
            eventType === WS_EVENTS.MESSAGE.HIDDEN) &&
          payload?.chatId &&
          Array.isArray(payload?.messageIds)
        ) {
          dropThreadMessages(queryClient, payload.chatId, payload.messageIds);
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

        // Собеседник получил или прочитал (#657): галочки и время своих
        // сообщений — в ленте и в списке чатов, без перезапроса.
        if (
          eventType === WS_EVENTS.MESSAGE.RECEIPTS &&
          payload?.chatId &&
          payload?.userId &&
          (payload?.kind === 'delivered' || payload?.kind === 'read') &&
          payload?.upTo &&
          payload?.at
        ) {
          putThreadReceipt(queryClient, payload);
          putChatListReceipt(queryClient, payload);
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
      // Пока связи не было, собеседники могли войти и выйти.
      refreshPresence(queryClient);
    });

    // Статус собеседника кладётся в кеш прямо из события (#780); выход —
    // с задержкой, чтобы обрыв связи на пару секунд не давал мигания.
    const presence = createPresenceBuffer(queryClient);
    const unsubscribePresence = eventBus.on(WS_EVENTS.USER.PRESENCE, (event) => {
      presence.push(event);
    });

    // Вкладка спала: браузер мог придержать сокет, и события прошли мимо.
    // Перечитываем статусы при возврате, но не чаще раза в полминуты.
    let lastPresenceRefresh = Date.now();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastPresenceRefresh < PRESENCE_REFRESH_MS) return;
      lastPresenceRefresh = Date.now();
      refreshPresence(queryClient);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Состав чата изменился — ключ чата пора менять: вошедший не должен
    // читать написанное до него, вышедший — написанное после.
    //
    // Менять может любой участник, кто в сети (#806). Сервер при изменении
    // состава поднимает пометку «нужна смена ключа» и принимает смену
    // атомарно: из одновременных проходит одна, остальные принимают её ключ.
    // Кто услышал событие позже, видит снятую пометку и ничего не делает.
    // Если в сети никого не было, ключ сменит первый, кто откроет чат.
    const rotateAfterMembershipChange = async (chatId?: string, removedUserId?: string) => {
      if (!chatId) return;

      // Ушли мы сами: в этом чате нас больше нет, и ключ менять не нам.
      if (removedUserId && removedUserId === services.cryptoService.getAccountId()) return;

      try {
        await services.cryptoService.rotateChatKeyIfNeeded(chatId);
      } catch (error) {
        console.warn('Не удалось обновить ключ чата после смены состава', error);
      }
    };

    const unsubscribeMemberAdded = eventBus.on(WS_EVENTS.CHAT.MEMBER_ADDED, (event) => {
      void rotateAfterMembershipChange(event?.chatId);
    });

    const unsubscribeMemberRemoved = eventBus.on(WS_EVENTS.CHAT.MEMBER_REMOVED, (event) => {
      void rotateAfterMembershipChange(event?.chatId, event?.userId);
    });

    // «Печатает» живёт три секунды и не кешируется — это не данные,
    // а эфемерное состояние интерфейса.
    const unsubscribeTyping = eventBus.on(WS_EVENTS.USER.TYPING, (event) => {
      const userId = event.userId || event.senderId;
      if (event.chatId && userId) setTyping(event.chatId, userId, event.firstName || undefined);
    });

    // Состояние связи отслеживается здесь, а не там, где показывается:
    // обрыв случается и на экране без индикатора.
    const stopConnectionWatch = startConnectionWatch();

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeTyping();
      unsubscribeReconnect();
      unsubscribePresence();
      presence.dispose();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribeMemberAdded();
      unsubscribeMemberRemoved();
      stopConnectionWatch();
    };
  }, [enabled, eventBus, queryClient, setTyping, clearTyping]);
}

/** Типы, которые адаптер сознательно пропускает. Экспорт для тестов. */
export { IGNORED_EVENTS };
