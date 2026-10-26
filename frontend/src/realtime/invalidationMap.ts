import type { QueryKey } from '@tanstack/react-query';
import { WS_EVENTS } from '@/shared/config';
import { chatKeys } from '@/entities/chat';
import { messageKeys } from '@/entities/message';
import { userKeys } from '@/entities/user';

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
  userId?: string;
  currentUserId?: string;
  version?: number;
}

type TInvalidationRule = (payload: IEventPayload) => QueryKey[];

export const INVALIDATION_MAP: Record<string, TInvalidationRule> = {
  [WS_EVENTS.USER.SETTINGS_UPDATED]: ({ userId, currentUserId, version }) =>
    userId && userId === currentUserId && version === 1 ? [userKeys.settings()] : [],
  [WS_EVENTS.MESSAGE.NEW]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.list()] : [chatKeys.list()],

  [WS_EVENTS.MESSAGE.EDITED]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.pins(chatId), chatKeys.list()] : [],

  // Удалённое сообщение могло быть закреплённым и последним в чате.
  [WS_EVENTS.MESSAGE.DELETED]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.pins(chatId), chatKeys.list()] : [],

  // Пачка удалена у всех или скрыта у себя (#840). Обычно сообщения
  // убираются из ленты на месте (useServerEvents); это — запасной путь.
  [WS_EVENTS.MESSAGE.BATCH_DELETED]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.pins(chatId), chatKeys.list()] : [],

  [WS_EVENTS.MESSAGE.HIDDEN]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.pins(chatId), chatKeys.list()] : [],

  // Галочки своих сообщений (#657). Обычно ставятся на месте
  // (useServerEvents); это — запасной путь.
  [WS_EVENTS.MESSAGE.RECEIPTS]: ({ chatId }) =>
    chatId ? [chatKeys.messages(chatId), chatKeys.list()] : [],

  [WS_EVENTS.REACTIONS.REACTION_UPDATED]: ({ chatId, messageId }) => {
    const keys: QueryKey[] = [];
    if (chatId) keys.push(chatKeys.messages(chatId));
    if (messageId) keys.push(messageKeys.reactionAuthorsPrefix(messageId));
    return keys;
  },

  [WS_EVENTS.MESSAGE.PINNED]: ({ chatId }) => (chatId ? [chatKeys.pins(chatId)] : []),

  [WS_EVENTS.MESSAGE.UNPINNED]: ({ chatId }) => (chatId ? [chatKeys.pins(chatId)] : []),

  [WS_EVENTS.CHAT.UPDATED]: ({ chatId }) =>
    chatId ? [chatKeys.detail(chatId), chatKeys.list()] : [chatKeys.list()],

  [WS_EVENTS.CHAT.MEMBER_ADDED]: ({ chatId }) =>
    chatId ? [chatKeys.members(chatId), chatKeys.detail(chatId)] : [],

  [WS_EVENTS.CHAT.MEMBER_REMOVED]: ({ chatId }) =>
    chatId ? [chatKeys.members(chatId), chatKeys.detail(chatId)] : [],

  [WS_EVENTS.CHAT.MEMBER_ROLE_UPDATED]: ({ chatId }) => (chatId ? [chatKeys.members(chatId)] : []),

  // Блокировка (#760): флаги чата и статус собеседника считает сервер —
  // перечитываем личный чат и список.
  [WS_EVENTS.USER.BLOCKED]: ({ chatId }) =>
    chatId ? [chatKeys.detail(chatId), chatKeys.list()] : [chatKeys.list()],

  [WS_EVENTS.USER.UNBLOCKED]: ({ chatId }) =>
    chatId ? [chatKeys.detail(chatId), chatKeys.list()] : [chatKeys.list()],

  // Обновление профиля/username (#724): перечитываем карточку пользователя,
  // список чатов (где имя собеседника в шапке/превью) и свой профиль, если событие своё.
  [WS_EVENTS.USER.PROFILE_UPDATED]: ({ userId, currentUserId }) => {
    const keys: QueryKey[] = [chatKeys.list()];
    if (userId) {
      keys.unshift(userKeys.profile(userId));
    }
    if (!userId || !currentUserId || userId === currentUserId) {
      keys.push(userKeys.me());
    }
    return keys;
  },
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
