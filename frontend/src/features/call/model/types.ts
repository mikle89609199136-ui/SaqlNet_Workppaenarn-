export type {
  ICallParticipant,
  ICallRoom,
  ICallRoomCreateRequest,
  ICallRoomResponse,
  IIceConfiguration,
  IIceServer,
  TCallKind,
  TCallRoomType,
} from '@/services/types/callApi.types';
import type { TCallKind, TCallRoomType } from '@/services/types/callApi.types';

export type TCallState =
  'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'reconnecting' | 'ended';

export type TCallConnectionState = RTCPeerConnectionState | 'reconnecting';

export type TCallEndReason =
  | 'completed'
  | 'peer_ended'
  | 'declined'
  | 'busy'
  | 'no_answer'
  | 'network_error'
  | 'media_denied'
  | 'cancelled';

export type TOutgoingCallPhase =
  | 'calling'
  | 'ringing'
  | 'declined'
  | 'busy'
  | 'no_answer'
  | 'cancelled'
  | 'failed';

export interface IOutgoingCall {
  roomId: string;
  peerId: string;
  peerName?: string | null;
  peerAvatar?: string | null;
  kind: TCallKind;
  phase: TOutgoingCallPhase;
  title?: string | null;
}

export interface IEndedCall {
  roomId: string;
  peerId?: string;
  peerName?: string | null;
  peerAvatar?: string | null;
  reason: TCallEndReason;
}

export interface ICallPeer {
  userId: string;
  displayName?: string;
  avatarUrl?: string | null;
}

// Исходящие сообщения в сокет
export interface ICallJoinOutgoing {
  type: 'call_join';
  roomId: string;
  displayName?: string;
  avatarUrl?: string | null;
  callKind?: TCallKind;
  chatId?: string;
  title?: string;
}

export interface ICallLeaveOutgoing {
  type: 'call_leave';
  roomId?: string;
}

export interface ICallInviteOutgoing {
  type: 'call_invite';
  to: string;
  roomId: string;
  kind?: TCallKind;
  callType?: 'p2p';
  fromName?: string;
  fromAvatar?: string | null;
  title?: string;
}

export interface ICallInviteResponseOutgoing {
  type: 'call_invite_response';
  to: string;
  roomId: string;
  accepted: boolean;
  reason?: string;
}

export interface ICallOfferOutgoing {
  type: 'call_offer';
  to: string;
  roomId?: string;
  payload: RTCSessionDescriptionInit;
}

export interface ICallAnswerOutgoing {
  type: 'call_answer';
  to: string;
  roomId?: string;
  payload: RTCSessionDescriptionInit;
}

export interface ICallIceOutgoing {
  type: 'call_ice';
  to: string;
  roomId?: string;
  payload: RTCIceCandidateInit;
}

export type TCallOutgoingMessage =
  | ICallJoinOutgoing
  | ICallLeaveOutgoing
  | ICallInviteOutgoing
  | ICallInviteResponseOutgoing
  | ICallOfferOutgoing
  | ICallAnswerOutgoing
  | ICallIceOutgoing;

// Входящие сообщения из сокета
export interface ICallJoinedIncoming {
  type: 'call_joined';
  roomId: string;
  peers: ICallPeer[];
  self: { userId: string };
}

export interface ICallPeerJoinedIncoming {
  type: 'call_peer_joined';
  roomId: string;
  peer: ICallPeer;
}

export interface ICallPeerLeftIncoming {
  type: 'call_peer_left';
  roomId: string;
  peer: { userId: string };
}

export interface ICallIncomingIncoming {
  type: 'call_incoming';
  roomId: string;
  kind: TCallKind;
  callType?: 'p2p' | 'group';
  from: string;
  fromName?: string;
  fromAvatar?: string | null;
  title?: string;
}

export interface ICallCancelledIncoming {
  type: 'call_cancelled';
  roomId: string;
}

export interface ICallErrorIncoming {
  type: 'call_error';
  reason: string;
}

export interface ICallInviteResponseIncoming {
  type: 'call_invite_response';
  roomId: string;
  from: string;
  accepted: boolean;
  reason?: string;
}

export interface ICallOfferIncoming {
  type: 'call_offer';
  roomId: string;
  from: string;
  payload: RTCSessionDescriptionInit;
}

export interface ICallAnswerIncoming {
  type: 'call_answer';
  roomId: string;
  from: string;
  payload: RTCSessionDescriptionInit;
}

export interface ICallIceIncoming {
  type: 'call_ice';
  roomId: string;
  from: string;
  payload: RTCIceCandidateInit;
}

export type TCallIncomingMessage =
  | ICallJoinedIncoming
  | ICallPeerJoinedIncoming
  | ICallPeerLeftIncoming
  | ICallIncomingIncoming
  | ICallCancelledIncoming
  | ICallErrorIncoming
  | ICallInviteResponseIncoming
  | ICallOfferIncoming
  | ICallAnswerIncoming
  | ICallIceIncoming;

// Интерфейсы для обратной совместимости существующего UI
export interface ICall {
  roomId: string;
  from: string;
}

export interface IIncomingCall extends ICall {
  fromName?: string;
  fromAvatar?: string | null;
  kind: TCallKind;
  title?: string;
  callType?: TCallRoomType;
}

export interface IActiveCall {
  roomId: string;
  type: TCallRoomType;
  kind: TCallKind;
  title?: string;
  chatId?: string;
  peerId?: string;
  peerName?: string;
  peerAvatar?: string | null;
  isCaller?: boolean;
}

export interface IRingtone {
  ctx: AudioContext;
  ringtoneTimer: ReturnType<typeof setInterval>;
  vibrateTimer: ReturnType<typeof setInterval> | null;
}

export interface ICallInviteResponsePayload {
  roomId: string;
  from?: string;
  accepted: boolean;
  reason?: string;
}

export interface ICallCancelledPayload {
  roomId: string;
}

export interface ICallSessionData {
  roomId: string;
  chatId?: string;
  peerId: string;
  peerName?: string;
  peerAvatar?: string | null;
  kind: TCallKind;
  title?: string;
  startedAt?: number;
}

// Медиа и устройства
export type TMediaErrorType =
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | 'OverconstrainedError'
  | 'InsecureContextError'
  | 'TimeoutError'
  | 'UnknownMediaError';

export interface IMediaError {
  type: TMediaErrorType;
  name: string;
  message: string;
  originalError?: unknown;
}

export type TFacingMode = 'user' | 'environment';

export interface IMediaDeviceOption {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId?: string;
}

export interface ILocalMediaState {
  stream: MediaStream | null;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  audioInputs: IMediaDeviceOption[];
  videoInputs: IMediaDeviceOption[];
  selectedAudioDeviceId: string | null;
  selectedVideoDeviceId: string | null;
  facingMode: TFacingMode;
  error: IMediaError | null;
  isLoading: boolean;
}

export interface IStartMediaOptions {
  kind?: TCallKind;
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
  audioDeviceId?: string;
  videoDeviceId?: string;
  facingMode?: TFacingMode;
  timeoutMs?: number;
}
