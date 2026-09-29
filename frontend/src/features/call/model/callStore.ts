import { create } from 'zustand';
import { services } from '@/services/serviceContainer';
import { startRingtone, stopRingtone } from '@/services/ringtone';
import { WebSocketClient } from '@/services/WebSocketClient';
import { useProfileStore, blockedUsersQuery, type IBlockedUserDto } from '@/entities/user';
import { queryClient } from '@/shared/api';
import { broadcastCallEvent, type TCallBroadcastEvent } from './callBroadcast';
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
  IOutgoingCall,
  TCallEndReason,
  TCallKind,
  TCallRoomType,
} from './types';

const CALL_TIMEOUT_MS = 60_000;

interface CallStoreState {
  fsm: ICallFsmContext;
  isMinimized: boolean;
  socket: WebSocketClient | null;
  callTimeoutTimer: ReturnType<typeof setTimeout> | null;

  // Селекторы совместимости с UI
  incomingCall: IIncomingCall | null;
  outgoingCall: IOutgoingCall | null;
  activeCall: IActiveCall | null;

  // Действия
  attachSocket: (socket: WebSocketClient | null) => void;
  dispatch: (action: TCallFsmAction) => void;

  handleIncoming: (payload: IIncomingCall) => Promise<void>;
  handleCancelled: (payload: ICallCancelledPayload | string) => void;
  handleInviteResponse: (payload: ICallInviteResponsePayload) => void;
  handleBroadcastEvent: (event: TCallBroadcastEvent) => void;
  handleOutgoingTimeout: () => void;

  initiateCall: (
    chatId: string,
    type: TCallRoomType,
    title: string,
    kind: TCallKind,
    peerId?: string | null,
    peerAvatar?: string | null,
    peerName?: string | null
  ) => Promise<void>;
  cancelCall: () => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: (reason?: TCallEndReason) => void;
  minimizeCall: () => void;
  maximizeCall: () => void;
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

    const outgoingCall: IOutgoingCall | null =
      fsm.state === 'outgoing'
        ? {
            roomId: fsm.roomId ?? '',
            peerId: fsm.peerId ?? '',
            peerName: fsm.peerName ?? fsm.title,
            peerAvatar: fsm.peerAvatar,
            kind: fsm.callKind,
            phase: fsm.outgoingPhase ?? (fsm.roomId ? 'ringing' : 'calling'),
            title: fsm.title,
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

    return { fsm, incomingCall, outgoingCall, activeCall };
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
    callTimeoutTimer: null,
    incomingCall: null,
    outgoingCall: null,
    activeCall: null,

    attachSocket: (socket) => set({ socket }),

    dispatch: (action) => {
      const currentFsm = get().fsm;
      const nextFsm = callStateReducer(currentFsm, action);
      if (nextFsm === currentFsm) return;
      set(syncDerivedState(nextFsm));
    },

    handleIncoming: async (payload) => {
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

      // Проверка чёрного списка (#727, #773)
      try {
        const query = blockedUsersQuery();
        const cachedBlocked = queryClient.getQueryData<IBlockedUserDto[]>(query.queryKey);
        const blockedUsers = cachedBlocked ?? (await queryClient.ensureQueryData(query));
        if (blockedUsers?.some((u) => u.id === payload.from)) {
          return;
        }
      } catch {
        // При сетевой ошибке не блокируем вызов ложно
      }

      // Проверяем актуальное состояние FSM после асинхронного вызова
      if (get().fsm.state !== 'idle' && get().fsm.state !== 'ended') {
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

      const soundsEnabled = useProfileStore.getState().settings.sounds;
      if (soundsEnabled !== false) {
        startRingtone();
      }
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

    handleBroadcastEvent: (event) => {
      const { fsm } = get();
      if (fsm.state === 'incoming' && (!event.roomId || fsm.roomId === event.roomId)) {
        stopRingtone();
        clearTimer();
        get().dispatch({ type: 'RESET_TO_IDLE' });
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
        get().dispatch({ type: 'SET_OUTGOING_PHASE', phase: reason });
        const finishedRoomId = fsm.roomId ?? undefined;
        get().dispatch({ type: 'END_CALL', reason });
        setTimeout(() => {
          get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
        }, 1500);
      }
    },

    initiateCall: async (chatId, type, title, kind, peerId, peerAvatar, peerName) => {
      const { socket, fsm } = get();
      if (fsm.state !== 'idle' && fsm.state !== 'ended') return;

      clearTimer();
      const targetPeerId = peerId ?? '';
      const targetPeerName = peerName ?? title;
      const targetPeerAvatar = peerAvatar ?? null;

      get().dispatch({
        type: 'START_OUTGOING',
        payload: {
          roomId: '',
          chatId,
          peerId: targetPeerId,
          peerName: targetPeerName,
          peerAvatar: targetPeerAvatar,
          kind,
          title,
          phase: 'calling',
        },
      });

      try {
        const response = await services.callService.createRoom({
          chatId,
          type: type === 'group' ? 'group' : 'p2p',
          title,
          callKind: kind,
        });

        const roomId = response.room?.id;
        if (!roomId) throw new Error('Room creation failed');

        // Проверяем, не отменил ли пользователь вызов до создания комнаты
        if (get().fsm.state !== 'outgoing') {
          if (socket?.isConnected) {
            sendCallLeave(socket, roomId);
          }
          return;
        }

        get().dispatch({
          type: 'SET_OUTGOING_PHASE',
          phase: 'ringing',
          roomId,
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
          get().handleOutgoingTimeout();
        }, CALL_TIMEOUT_MS);
        set({ callTimeoutTimer: timer });
      } catch {
        if (get().fsm.state === 'outgoing') {
          get().dispatch({ type: 'END_CALL', reason: 'network_error' });
          setTimeout(() => {
            get().dispatch({ type: 'RESET_TO_IDLE' });
          }, 1500);
        }
      }
    },

    cancelCall: () => {
      clearTimer();
      const { fsm, socket } = get();
      if (fsm.state !== 'outgoing') return;

      if (socket?.isConnected && fsm.roomId) {
        sendCallLeave(socket, fsm.roomId);
      }
      if (fsm.roomId) {
        broadcastCallEvent({ type: 'CALL_DISMISSED', roomId: fsm.roomId });
      }

      get().dispatch({ type: 'SET_OUTGOING_PHASE', phase: 'cancelled' });
      const finishedRoomId = fsm.roomId ?? undefined;
      get().dispatch({ type: 'END_CALL', reason: 'cancelled' });
      setTimeout(() => {
        get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
      }, 400);
    },

    handleOutgoingTimeout: () => {
      const { fsm, socket } = get();
      if (fsm.state !== 'outgoing') return;

      clearTimer();
      if (socket?.isConnected && fsm.roomId) {
        sendCallLeave(socket, fsm.roomId);
      }

      get().dispatch({ type: 'SET_OUTGOING_PHASE', phase: 'no_answer' });
      const finishedRoomId = fsm.roomId ?? undefined;
      get().dispatch({ type: 'END_CALL', reason: 'no_answer' });
      setTimeout(() => {
        get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
      }, 1500);
    },

    acceptCall: () => {
      stopRingtone();
      const { fsm, socket } = get();
      if (!fsm.roomId || !fsm.peerId) return;

      broadcastCallEvent({ type: 'CALL_ACCEPTED', roomId: fsm.roomId });

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
      if (fsm.roomId) {
        broadcastCallEvent({ type: 'CALL_DISMISSED', roomId: fsm.roomId });
      }
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
      const { fsm, socket } = get();

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
