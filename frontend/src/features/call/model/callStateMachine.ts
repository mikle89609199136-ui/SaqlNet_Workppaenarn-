import type {
  TCallEndReason,
  TCallKind,
  TCallRoomType,
  TCallState,
  TOutgoingCallPhase,
} from './types';

export interface ICallFsmContext {
  state: TCallState;
  roomId: string | null;
  chatId: string | null;
  peerId: string | null;
  peerName: string | null;
  peerAvatar: string | null;
  callKind: TCallKind;
  roomType: TCallRoomType;
  title: string | null;
  endReason: TCallEndReason | null;
  callStartedAt: number | null;
  outgoingPhase?: TOutgoingCallPhase | null;
}

export type TCallFsmAction =
  | {
      type: 'START_OUTGOING';
      payload: {
        roomId?: string;
        chatId: string;
        peerId: string;
        peerName?: string | null;
        peerAvatar?: string | null;
        kind: TCallKind;
        title?: string;
        phase?: TOutgoingCallPhase;
      };
    }
  | {
      type: 'SET_OUTGOING_PHASE';
      phase: TOutgoingCallPhase;
      roomId?: string;
    }
  | {
      type: 'RECEIVE_INCOMING';
      payload: {
        roomId: string;
        from: string;
        fromName?: string;
        fromAvatar?: string | null;
        kind: TCallKind;
        title?: string;
      };
    }
  | { type: 'ACCEPT_INCOMING' }
  | { type: 'PEER_ACCEPTED' }
  | { type: 'PEER_JOINED' }
  | { type: 'CONNECTION_LOST' }
  | { type: 'CONNECTION_RESTORED' }
  | { type: 'END_CALL'; reason: TCallEndReason }
  | { type: 'RESET_TO_IDLE'; roomId?: string };

export const initialCallContext: ICallFsmContext = {
  state: 'idle',
  roomId: null,
  chatId: null,
  peerId: null,
  peerName: null,
  peerAvatar: null,
  callKind: 'audio',
  roomType: 'p2p',
  title: null,
  endReason: null,
  callStartedAt: null,
  outgoingPhase: null,
};

export function callStateReducer(ctx: ICallFsmContext, action: TCallFsmAction): ICallFsmContext {
  switch (action.type) {
    case 'START_OUTGOING': {
      if (ctx.state !== 'idle' && ctx.state !== 'ended') {
        return ctx;
      }
      return {
        ...initialCallContext,
        state: 'outgoing',
        roomId: action.payload.roomId || null,
        chatId: action.payload.chatId,
        peerId: action.payload.peerId,
        peerName: action.payload.peerName ?? null,
        peerAvatar: action.payload.peerAvatar ?? null,
        callKind: action.payload.kind,
        title: action.payload.title ?? null,
        outgoingPhase: action.payload.phase ?? (action.payload.roomId ? 'ringing' : 'calling'),
      };
    }

    case 'SET_OUTGOING_PHASE': {
      if (ctx.state !== 'outgoing') return ctx;
      return {
        ...ctx,
        outgoingPhase: action.phase,
        roomId: action.roomId ?? ctx.roomId,
      };
    }

    case 'RECEIVE_INCOMING': {
      if (ctx.state !== 'idle' && ctx.state !== 'ended') {
        return ctx;
      }
      return {
        ...initialCallContext,
        state: 'incoming',
        roomId: action.payload.roomId,
        peerId: action.payload.from,
        peerName: action.payload.fromName ?? null,
        peerAvatar: action.payload.fromAvatar ?? null,
        callKind: action.payload.kind,
        title: action.payload.title ?? null,
      };
    }

    case 'ACCEPT_INCOMING': {
      if (ctx.state !== 'incoming') return ctx;
      return {
        ...ctx,
        state: 'connecting',
      };
    }

    case 'PEER_ACCEPTED': {
      if (ctx.state !== 'outgoing') return ctx;
      return {
        ...ctx,
        state: 'connecting',
      };
    }

    case 'PEER_JOINED': {
      if (ctx.state !== 'connecting' && ctx.state !== 'outgoing') return ctx;
      return {
        ...ctx,
        state: 'active',
        callStartedAt: ctx.callStartedAt ?? Date.now(),
      };
    }

    case 'CONNECTION_LOST': {
      if (ctx.state !== 'active') return ctx;
      return {
        ...ctx,
        state: 'reconnecting',
      };
    }

    case 'CONNECTION_RESTORED': {
      if (ctx.state !== 'reconnecting') return ctx;
      return {
        ...ctx,
        state: 'active',
      };
    }

    case 'END_CALL': {
      if (ctx.state === 'idle') return ctx;
      return {
        ...ctx,
        state: 'ended',
        endReason: action.reason,
      };
    }

    case 'RESET_TO_IDLE': {
      if (ctx.state === 'ended' && (!action.roomId || ctx.roomId === action.roomId)) {
        return initialCallContext;
      }
      return ctx;
    }

    default:
      return ctx;
  }
}
