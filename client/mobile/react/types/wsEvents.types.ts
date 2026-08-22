import type { WS_EVENTS } from '@/consts';
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
  previousMessage: IMessageDto | null
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
  chatId: string
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

export interface ITypingEvent {
  type: string;
  chatId: string;
  userId: string;
  senderId: string;
}

export interface ICallErrorEvent {
  type: string;
  reason: string;
}

interface IPeer {
  userId: string;
  displayName: string;
  avatarUrl: string;
}

export interface ICallJoinedEvent {
  type: string;
  roomId: string;
  peers: IPeer[];
  self: { userId: string };
}
export interface ICallPeerJoinedEvent {
  type: string;
  roomId: string;
  peer: IPeer;
}
export interface ICallPeerLeftEvent {
  type: string;
  roomId: string;
  peer: { userId: string };
}
export interface ICallIncomingEvent {
  type: string;
  roomId: string;
  kind: string;
  callType: string;
  from: string;
  fromName: string;
  fromAvatar: string;
  title: string;
}
export interface ICallCenceledEvent {
  type: string;
  roomId: string;
}
export interface ICallInviteResponseEvent {
  type: string;
  roomId: string;
  from: string;
  accepted: string;
  reason: string;
}
export interface ICallOfferEvent {
  type: string;
  roomId: string;
  from: string;
  payload: any;
}
export interface ICallAnswerEvent {
  type: string;
  roomId: string;
  from: string;
  payload: any;
}
export interface ICallIceEvent {
  type: string;
  roomId: string;
  from: string;
  payload: any;
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

export interface IWsEventMap {
  [WS_EVENTS.CALL.ANSWER]: ICallAnswerEvent;
  [WS_EVENTS.CALL.CANCELED]: ICallCenceledEvent;
  [WS_EVENTS.CALL.ERROR]: ICallErrorEvent;
  [WS_EVENTS.CALL.ICE]: ICallIceEvent;
  [WS_EVENTS.CALL.INCOMING]: ICallIncomingEvent;
  [WS_EVENTS.CALL.INVITE_RESPONSE]: ICallInviteResponseEvent;
  [WS_EVENTS.CALL.JOINED]: ICallJoinedEvent;
  [WS_EVENTS.CALL.OFFER]: ICallOfferEvent;
  [WS_EVENTS.CALL.PEER_JOINED]: ICallPeerJoinedEvent;
  [WS_EVENTS.CALL.PEER_LEFT]: ICallPeerLeftEvent;

  [WS_EVENTS.CHAT.ADD_MEMBER]: IChatAddMemberEvent;
  [WS_EVENTS.CHAT.UPDATED]: IChatUpdatedEvent;

  [WS_EVENTS.MESSAGE.DELETED]: IMessageDeletedEvent;
  [WS_EVENTS.MESSAGE.LOCAL.DELETED]: IMessageDeletedEvent;
  [WS_EVENTS.MESSAGE.EDITED]: IMessageEditedEvent;
  [WS_EVENTS.MESSAGE.LOCAL.EDITED]: IMessageEditedEvent;
  [WS_EVENTS.MESSAGE.NEW]: IMessageNewEvent;
  [WS_EVENTS.MESSAGE.LOCAL.SENT]: IMessageNewEvent;
  [WS_EVENTS.MESSAGE.PINNED]: IMessagePinEvent;
  [WS_EVENTS.MESSAGE.UNPINNED]: IMessageUnpinEvent;
  [WS_EVENTS.MESSAGE.LOCAL.READ]: IMessagesReadEvent

  [WS_EVENTS.OTHER.PING]: IPingEvent;
  [WS_EVENTS.OTHER.PONG]: IPongEvent;

  [WS_EVENTS.REACTIONS.REACTION_UPDATED]: IReactionUpdatedEvent;

  [WS_EVENTS.USER.TYPING]: ITypingEvent;
}
