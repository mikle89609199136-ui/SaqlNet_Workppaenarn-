import type { WebSocketClient } from '@/services/WebSocketClient';
import type {
  ICallAnswerOutgoing,
  ICallIceOutgoing,
  ICallInviteOutgoing,
  ICallInviteResponseOutgoing,
  ICallJoinOutgoing,
  ICallLeaveOutgoing,
  ICallOfferOutgoing,
  TCallKind,
} from './types';

export function sendCallJoin(
  socket: WebSocketClient,
  params: {
    roomId: string;
    displayName?: string;
    avatarUrl?: string | null;
    callKind?: TCallKind;
    chatId?: string;
    title?: string;
  }
): void {
  const msg: ICallJoinOutgoing = {
    type: 'call_join',
    ...params,
  };
  socket.send(msg);
}

export function sendCallLeave(socket: WebSocketClient, roomId?: string): void {
  const msg: ICallLeaveOutgoing = {
    type: 'call_leave',
    roomId,
  };
  socket.send(msg);
}

export function sendCallInvite(
  socket: WebSocketClient,
  params: {
    to: string;
    roomId: string;
    kind?: TCallKind;
    fromName?: string;
    fromAvatar?: string | null;
    title?: string;
  }
): void {
  const msg: ICallInviteOutgoing = {
    type: 'call_invite',
    callType: 'p2p',
    ...params,
  };
  socket.send(msg);
}

export function sendCallInviteResponse(
  socket: WebSocketClient,
  params: { to: string; roomId: string; accepted: boolean; reason?: string }
): void {
  const msg: ICallInviteResponseOutgoing = {
    type: 'call_invite_response',
    ...params,
  };
  socket.send(msg);
}

export function sendCallOffer(
  socket: WebSocketClient,
  params: { to: string; roomId?: string; payload: RTCSessionDescriptionInit }
): void {
  const msg: ICallOfferOutgoing = {
    type: 'call_offer',
    ...params,
  };
  socket.send(msg);
}

export function sendCallAnswer(
  socket: WebSocketClient,
  params: { to: string; roomId?: string; payload: RTCSessionDescriptionInit }
): void {
  const msg: ICallAnswerOutgoing = {
    type: 'call_answer',
    ...params,
  };
  socket.send(msg);
}

export function sendCallIce(
  socket: WebSocketClient,
  params: { to: string; roomId?: string; payload: RTCIceCandidateInit }
): void {
  const msg: ICallIceOutgoing = {
    type: 'call_ice',
    ...params,
  };
  socket.send(msg);
}
