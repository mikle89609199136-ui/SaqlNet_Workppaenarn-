import type { QueryKey } from '@tanstack/react-query';
import { WS_EVENTS } from '@/shared/config';
import { chatKeys } from '@/entities/chat';

/**
 * Что устаревает при каждом событии сервера.
 *
 * Таблица данных, а не набор обработчиков: связь «что пришло — что нужно
 * перезапросить» видна целиком на одном экране и проверяется как чистая
 * функция, без React и без сокета.
 *
 * Раньше эта связь существовала только в виде подписок, разбросанных по
 * компонентам: чтобы понять, почему обновился список чатов, приходилось
 * обыскивать проект.
 */

interface IEventPayload {
  chatId?: string;
  messageId?: string;
}

type TInvalidationRule = (payload: IEventPayload) => QueryKey[];

export const INVALIDATION_MAP: Record<string, TInvalidationRule> = {
  [WS_EVENTS.MESSAGE.NEW]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.list()] : [chatKeys.list()],

  [WS_EVENTS.MESSAGE.EDITED]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.pins(chatId), chatKeys.list()] : [],

  // Удалённое сообщение могло быть закреплённым и последним в чате.
  [WS_EVENTS.MESSAGE.DELETED]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.pins(chatId), chatKeys.list()] : [],

  [WS_EVENTS.REACTIONS.REACTION_UPDATED]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId)] : [],

  [WS_EVENTS.MESSAGE.PINNED]: ({ chatId }) => (chatId ? [chatKeys.pins(chatId)] : []),

  [WS_EVENTS.MESSAGE.UNPINNED]: ({ chatId }) => (chatId ? [chatKeys.pins(chatId)] : []),

  [WS_EVENTS.CHAT.UPDATED]: ({ chatId }) =>
    chatId ? [chatKeys.detail(chatId), chatKeys.list()] : [chatKeys.list()],

  [WS_EVENTS.CHAT.MEMBER_ADDED]: ({ chatId }) =>
    chatId ? [chatKeys.members(chatId), chatKeys.detail(chatId)] : [],

  [WS_EVENTS.CHAT.MEMBER_REMOVED]: ({ chatId }) =>
    chatId ? [chatKeys.members(chatId), chatKeys.detail(chatId)] : [],

  [WS_EVENTS.CHAT.MEMBER_ROLE_UPDATED]: ({ chatId }) => (chatId ? [chatKeys.members(chatId)] : []),
};

/**
 * События, которые намеренно не трогают кеш.
 *
 * Список ведётся явно, чтобы проверка полноты могла отличить «решили не
 * обрабатывать» от «забыли обработать».
 */
export const IGNORED_EVENTS: string[] = [
  // Эфемерное состояние: живёт три секунды и не кешируется.
  WS_EVENTS.USER.TYPING,
  // Статус кладётся в кеш прямо из события, без перезапроса —
  // см. applyPresence.
  WS_EVENTS.USER.PRESENCE,
  // Служебные события транспорта. Восстановление связи таблице не
  // подчиняется: там не инвалидация, а догрузка пропущенного —
  // см. resyncAfterReconnect.
  WS_EVENTS.SOCKET.CONNECTED,
  WS_EVENTS.SOCKET.DISCONNECTED,
  WS_EVENTS.SOCKET.ERROR,
  WS_EVENTS.SOCKET.MESSAGE,
  WS_EVENTS.OTHER.PING,
  WS_EVENTS.OTHER.PONG,
  // Сигналинг звонков: у него нет свежести, нечего инвалидировать
  // и незачем перезапрашивать.
  WS_EVENTS.CALL.ERROR,
  WS_EVENTS.CALL.JOINED,
  WS_EVENTS.CALL.PEER_JOINED,
  WS_EVENTS.CALL.PEER_LEFT,
  WS_EVENTS.CALL.INCOMING,
  WS_EVENTS.CALL.CANCELED,
  WS_EVENTS.CALL.INVITE_RESPONSE,
  WS_EVENTS.CALL.OFFER,
  WS_EVENTS.CALL.ANSWER,
  WS_EVENTS.CALL.ICE,
];

export function resolveInvalidations(eventType: string, payload: IEventPayload): QueryKey[] {
  return INVALIDATION_MAP[eventType]?.(payload) ?? [];
}
