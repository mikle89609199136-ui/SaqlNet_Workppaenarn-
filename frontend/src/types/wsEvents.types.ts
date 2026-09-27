import type { WS_EVENTS } from '@/shared/config';
import type {
  IChatDto,
  IMemberDto,
  IMessageDto,
  IPinnedDto,
  TMessageType,
  TReactionsList,
} from '@/types';

export interface IMessageNewEvent {
  type: string;
  chatId: string;
  message: IMessageDto;
}
export interface IMessageEditedEvent {
  type: string;
  chatId: string;
  messageId: string;
  content: string;
  updatedAt: Date;
}
export interface IMessageDeletedEvent {
  type: string;
  messageId: string;
  previousMessage: IMessageDto | null;
  chatId: string;
}
export interface IMessagePinEvent {
  type: string;
  chatId: string;
  messageId: string;
  pin: IPinnedDto;
}
export interface IMessageUnpinEvent {
  type: string;
  chatId: string;
  messageId: string;
}

export interface IReactionUpdatedEvent {
  type: string;
  chatId: string;
  messageId: string;
  reactions: TReactionsList;
}

export interface IMessagesReadEvent {
  chatId: string;
}

export interface IChatUpdatedEvent {
  type: string;
  chatId: string;
  chat: IChatDto;
}

export interface IChatAddMemberEvent {
  type: string;
  chatId: string;
  member: IMemberDto;
}

export interface IChatMemberRemovedEvent {
  type: string;
  chatId: string;
  userId: string;
  reason?: string;
}

export interface IChatMemberRoleUpdatedEvent {
  type: string;
  chatId: string;
  userId: string;
  role: string;
}

/**
 * Статус собеседника по личному чату (#780). Приходит, когда закрыто
 * последнее соединение или открыто первое; скрытый приватностью статус
 * не присылается вовсе.
 */
export interface IPresenceChangedEvent {
  type: string;
  userId: string;
  isOnline: boolean;
  /** ISO 8601, UTC. */
  lastSeen: string;
}

/** Блокировка или её снятие (#760): кто, кого и их личный чат, если он есть. */
export interface IUserBlockEvent {
  type: string;
  userId: string;
  blockedUserId: string;
  chatId: string;
}

export interface ITypingEvent {
  type: string;
  chatId: string;
  userId: string;
  senderId: string;
  /** Имя печатающего — сервер добавляет его в #866; до того поля нет. */
  firstName?: string;
}

export interface ILastMessagePayloadDto {
  chatId: string;
  message: {
    content: string;
    message: {
      chatId: string;
      content: string;
      createdAt: Date;
      id: string;
      isEdited: boolean;
      isForwarded: boolean;
      isPinned: boolean;
      senderFirstName: string;
      senderId: string;
      senderName: string;
      type: TMessageType;
      updatedAt: Date;
    };
  };
}

export interface IPingEvent {
  type: 'ping';
}
export interface IPongEvent {
  type: 'pong';
}

type ValueOf<T> = T[keyof T];

export type TWsEventType = ValueOf<{
  [K in keyof typeof WS_EVENTS]: ValueOf<(typeof WS_EVENTS)[K]>;
}>;

export interface ICallPeerDto {
  userId: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface ICallErrorEvent {
  type: string;
  reason: string;
  roomId?: string;
}

export interface ICallJoinedEvent {
  type: string;
  roomId: string;
  peers: ICallPeerDto[];
  self: { userId: string };
}

export interface ICallPeerJoinedEvent {
  type: string;
  roomId: string;
  peer: ICallPeerDto;
}

export interface ICallPeerLeftEvent {
  type: string;
  roomId: string;
  peer: { userId: string };
}

export interface ICallIncomingEvent {
  type: string;
  roomId: string;
  kind: 'audio' | 'video';
  callType?: string;
  from: string;
  fromName?: string;
  fromAvatar?: string | null;
  title?: string;
}

export interface ICallCancelledEvent {
  type: string;
  roomId: string;
}

export interface ICallInviteResponseEvent {
  type: string;
  roomId: string;
  from?: string;
  accepted: boolean;
  reason?: string;
}

export interface ICallOfferEvent {
  type: string;
  roomId: string;
  from: string;
  payload: RTCSessionDescriptionInit;
}

export interface ICallAnswerEvent {
  type: string;
  roomId: string;
  from: string;
  payload: RTCSessionDescriptionInit;
}

export interface ICallIceEvent {
  type: string;
  roomId: string;
  from: string;
  payload: RTCIceCandidateInit;
}

export interface IWsEventMap {
  [WS_EVENTS.CALL.ANSWER]: ICallAnswerEvent;
  [WS_EVENTS.CALL.CANCELED]: ICallCancelledEvent;
  [WS_EVENTS.CALL.ERROR]: ICallErrorEvent;
  [WS_EVENTS.CALL.ICE]: ICallIceEvent;
  [WS_EVENTS.CALL.INCOMING]: ICallIncomingEvent;
  [WS_EVENTS.CALL.INVITE_RESPONSE]: ICallInviteResponseEvent;
  [WS_EVENTS.CALL.JOINED]: ICallJoinedEvent;
  [WS_EVENTS.CALL.OFFER]: ICallOfferEvent;
  [WS_EVENTS.CALL.PEER_JOINED]: ICallPeerJoinedEvent;
  [WS_EVENTS.CALL.PEER_LEFT]: ICallPeerLeftEvent;

  [WS_EVENTS.CHAT.MEMBER_ADDED]: IChatAddMemberEvent;
  [WS_EVENTS.CHAT.MEMBER_REMOVED]: IChatMemberRemovedEvent;
  [WS_EVENTS.CHAT.MEMBER_ROLE_UPDATED]: IChatMemberRoleUpdatedEvent;
  [WS_EVENTS.CHAT.UPDATED]: IChatUpdatedEvent;

  [WS_EVENTS.MESSAGE.DELETED]: IMessageDeletedEvent;
  [WS_EVENTS.MESSAGE.EDITED]: IMessageEditedEvent;
  [WS_EVENTS.MESSAGE.NEW]: IMessageNewEvent;
  [WS_EVENTS.MESSAGE.PINNED]: IMessagePinEvent;
  [WS_EVENTS.MESSAGE.UNPINNED]: IMessageUnpinEvent;

  [WS_EVENTS.OTHER.PING]: IPingEvent;
  [WS_EVENTS.OTHER.PONG]: IPongEvent;

  [WS_EVENTS.REACTIONS.REACTION_UPDATED]: IReactionUpdatedEvent;

  [WS_EVENTS.USER.TYPING]: ITypingEvent;
  [WS_EVENTS.USER.PRESENCE]: IPresenceChangedEvent;
  [WS_EVENTS.USER.BLOCKED]: IUserBlockEvent;
  [WS_EVENTS.USER.UNBLOCKED]: IUserBlockEvent;
}
