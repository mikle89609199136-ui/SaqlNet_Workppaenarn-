import { create } from 'zustand';
import { services } from '@/services/serviceContainer';
import { startRingtone, stopRingtone } from '@/services/ringtone';
import { WebSocketClient } from '@/services/WebSocketClient';
import { useProfileStore } from '@/entities/user';
import {
  callStateReducer,
  initialCallContext,
  type ICallFsmContext,
  type TCallFsmAction,
} from './callStateMachine';
import { sendCallInvite, sendCallInviteResponse, sendCallLeave } from './callSignaling';
import type {
  IActiveCall,
  ICallCancelledPayload,
  ICallInviteResponsePayload,
  IIncomingCall,
  TCallEndReason,
  TCallKind,
  TCallRoomType,
} from './types';

const CALL_TIMEOUT_MS = 60_000;

interface CallStoreState {
  fsm: ICallFsmContext;
  isMinimized: boolean;
  socket: WebSocketClient | null;
  callFrameRef: HTMLIFrameElement | null;
  callTimeoutTimer: ReturnType<typeof setTimeout> | null;

  // Селекторы совместимости с UI
  incomingCall: IIncomingCall | null;
  activeCall: IActiveCall | null;

  // Действия
  attachSocket: (socket: WebSocketClient | null) => void;
  attachCallFrame: (callFrameRef: HTMLIFrameElement | null) => void;
  dispatch: (action: TCallFsmAction) => void;

  handleIncoming: (payload: IIncomingCall) => void;
  handleCancelled: (payload: ICallCancelledPayload | string) => void;
  handleInviteResponse: (payload: ICallInviteResponsePayload) => void;

  initiateCall: (
    chatId: string,
    type: TCallRoomType,
    title: string,
    kind: TCallKind,
    peerId?: string | null
  ) => Promise<void>;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: (reason?: TCallEndReason) => void;
  minimizeCall: () => void;
  maximizeCall: () => void;
}

function postHangup(frame: HTMLIFrameElement | null): void {
  try {
    frame?.contentWindow?.postMessage({ type: 'crane_hangup' }, '*');
  } catch {
    // Ignore cross-origin frame postMessage errors
  }
}

function formatCallerName(
  user?: { firstName?: string; lastName?: string; username?: string } | null
): string | undefined {
  if (!user) return undefined;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return fullName || user.username || undefined;
}

export const useCallStore = create<CallStoreState>((set, get) => {
  const syncDerivedState = (fsm: ICallFsmContext) => {
    const incomingCall: IIncomingCall | null =
      fsm.state === 'incoming' && fsm.roomId && fsm.peerId
        ? {
            roomId: fsm.roomId,
            from: fsm.peerId,
            fromName: fsm.peerName ?? undefined,
            fromAvatar: fsm.peerAvatar,
            kind: fsm.callKind,
            title: fsm.title ?? undefined,
            callType: fsm.roomType,
          }
        : null;

    const activeCall: IActiveCall | null =
      (fsm.state === 'connecting' || fsm.state === 'active' || fsm.state === 'outgoing') &&
      fsm.roomId
        ? {
            roomId: fsm.roomId,
            type: fsm.roomType,
            kind: fsm.callKind,
            title: fsm.title ?? undefined,
            chatId: fsm.chatId ?? undefined,
          }
        : null;

    return { fsm, incomingCall, activeCall };
  };

  const clearTimer = () => {
    const timer = get().callTimeoutTimer;
    if (timer) clearTimeout(timer);
    set({ callTimeoutTimer: null });
  };

  return {
    fsm: initialCallContext,
    isMinimized: false,
    socket: null,
    callFrameRef: null,
    callTimeoutTimer: null,
    incomingCall: null,
    activeCall: null,

    attachSocket: (socket) => set({ socket }),
    attachCallFrame: (callFrameRef) => set({ callFrameRef }),

    dispatch: (action) => {
      const currentFsm = get().fsm;
      const nextFsm = callStateReducer(currentFsm, action);
      if (nextFsm === currentFsm) return;
      set(syncDerivedState(nextFsm));
    },

    handleIncoming: (payload) => {
      const { fsm, socket } = get();

      // Повторный incoming для той же комнаты игнорируем (уже звенит)
      if (fsm.state === 'incoming' && fsm.roomId === payload.roomId) {
        return;
      }

      // Если уже в другом звонке — автоответ busy
      if (fsm.state !== 'idle' && fsm.state !== 'ended') {
        if (socket?.isConnected && payload.from) {
          sendCallInviteResponse(socket, {
            to: payload.from,
            roomId: payload.roomId,
            accepted: false,
            reason: 'busy',
          });
        }
        return;
      }

      get().dispatch({
        type: 'RECEIVE_INCOMING',
        payload: {
          roomId: payload.roomId,
          from: payload.from,
          fromName: payload.fromName,
          fromAvatar: payload.fromAvatar,
          kind: payload.kind,
          title: payload.title,
        },
      });

      startRingtone();
    },

    handleCancelled: (payload) => {
      const roomId = typeof payload === 'string' ? payload : payload.roomId;
      const { fsm } = get();
      if (fsm.roomId === roomId) {
        stopRingtone();
        clearTimer();
        const finishedRoomId = fsm.roomId;
        get().dispatch({ type: 'END_CALL', reason: 'peer_ended' });
        setTimeout(() => {
          get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
        }, 1500);
      }
    },

    handleInviteResponse: (payload) => {
      const { fsm } = get();
      if (fsm.roomId !== payload.roomId) return;

      clearTimer();

      if (payload.accepted) {
        get().dispatch({ type: 'PEER_ACCEPTED' });
      } else {
        const reason: TCallEndReason = payload.reason === 'busy' ? 'busy' : 'declined';
        get().endCall(reason);
      }
    },

    initiateCall: async (chatId, type, title, kind, peerId) => {
      const { socket, fsm } = get();
      if (fsm.state !== 'idle' && fsm.state !== 'ended') return;

      try {
        const response = await services.callService.createRoom({
          chatId,
          type: type === 'group' ? 'group' : 'p2p',
          title,
          callKind: kind,
        });

        const roomId = response.room?.id;
        if (!roomId) throw new Error('Room creation failed');
        const targetPeerId = peerId ?? '';

        get().dispatch({
          type: 'START_OUTGOING',
          payload: {
            roomId,
            chatId,
            peerId: targetPeerId,
            kind,
            title,
          },
        });

        if (socket?.isConnected && targetPeerId) {
          const profile = useProfileStore.getState().user;
          sendCallInvite(socket, {
            to: targetPeerId,
            roomId,
            kind,
            fromName: formatCallerName(profile),
            fromAvatar: profile?.avatarUrl,
            title,
          });
        }

        // Таймер ожидания ответа 60 секунд
        const timer = setTimeout(() => {
          get().endCall('no_answer');
        }, CALL_TIMEOUT_MS);
        set({ callTimeoutTimer: timer });
      } catch {
        get().dispatch({ type: 'END_CALL', reason: 'network_error' });
      }
    },

    acceptCall: () => {
      stopRingtone();
      const { fsm, socket } = get();
      if (!fsm.roomId || !fsm.peerId) return;

      get().dispatch({ type: 'ACCEPT_INCOMING' });

      if (socket?.isConnected) {
        sendCallInviteResponse(socket, {
          to: fsm.peerId,
          roomId: fsm.roomId,
          accepted: true,
        });
      }
    },

    rejectCall: () => {
      stopRingtone();
      const { fsm, socket } = get();
      if (socket?.isConnected && fsm.roomId && fsm.peerId) {
        sendCallInviteResponse(socket, {
          to: fsm.peerId,
          roomId: fsm.roomId,
          accepted: false,
          reason: 'declined',
        });
      }
      const finishedRoomId = fsm.roomId ?? undefined;
      get().dispatch({ type: 'END_CALL', reason: 'declined' });
      setTimeout(() => {
        get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
      }, 500);
    },

    endCall: (reason: TCallEndReason = 'completed') => {
      stopRingtone();
      clearTimer();
      const { fsm, socket, callFrameRef } = get();

      postHangup(callFrameRef);

      if (socket?.isConnected && fsm.roomId) {
        sendCallLeave(socket, fsm.roomId);
      }

      const finishedRoomId = fsm.roomId ?? undefined;
      get().dispatch({ type: 'END_CALL', reason });

      setTimeout(() => {
        get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
        if (get().fsm.state === 'idle') {
          set({ isMinimized: false });
        }
      }, 800);
    },

    minimizeCall: () => set({ isMinimized: true }),
    maximizeCall: () => set({ isMinimized: false }),
  };
});
