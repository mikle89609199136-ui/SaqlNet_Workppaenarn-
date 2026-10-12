import { create } from 'zustand';
import { services } from '@/services/serviceContainer';
import { startRingtone, stopRingtone } from '@/services/ringtone';
import { WebSocketClient } from '@/services/WebSocketClient';
import {
  useProfileStore,
  blockedUsersQuery,
  userProfileQuery,
  userKeys,
  type IBlockedUserDto,
} from '@/entities/user';
import { chatsQuery, chatQuery, chatKeys, type IChatDto } from '@/entities/chat';
import { queryClient } from '@/shared/api';
import { broadcastCallEvent, type TCallBroadcastEvent } from './callBroadcast';
import {
  callStateReducer,
  initialCallContext,
  type ICallFsmContext,
  type TCallFsmAction,
} from './callStateMachine';
import {
  sendCallInvite,
  sendCallInviteResponse,
  sendCallJoin,
  sendCallLeave,
} from './callSignaling';
import {
  clearCallSession,
  loadCallSession,
  saveCallSession,
  type IStoredCallSession,
} from './callSessionStorage';
import { callKeys } from './callKeys';
import type {
  IActiveCall,
  ICallCancelledPayload,
  ICallInviteResponsePayload,
  IEndedCall,
  IIncomingCall,
  IOutgoingCall,
  IResumableCall,
  TCallEndReason,
  TCallKind,
  TCallRoomType,
} from './types';

export const CALL_TIMEOUT_MS = 60_000;
export const RECONNECT_TIMEOUT_MS = 25_000;

interface CallStoreState {
  fsm: ICallFsmContext;
  currentAttemptId: number;
  isMinimized: boolean;
  socket: WebSocketClient | null;
  callTimeoutTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimeoutTimer: ReturnType<typeof setTimeout> | null;

  // Селекторы совместимости с UI
  incomingCall: IIncomingCall | null;
  outgoingCall: IOutgoingCall | null;
  activeCall: IActiveCall | null;
  endedCall: IEndedCall | null;
  /** Звонок, из которого ушли перезагрузкой страницы: вернуться — кнопкой. */
  resumableCall: IResumableCall | null;
  resumableSession: IStoredCallSession | null;
  resumeExpiryTimer: ReturnType<typeof setTimeout> | null;

  // Действия
  attachSocket: (socket: WebSocketClient | null) => void;
  dispatch: (action: TCallFsmAction) => void;
  rejoinActiveCall: () => void;
  restoreActiveSession: () => boolean;
  resumeCall: () => void;
  dismissResumableCall: () => void;

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

const MAX_CANCELLED_ROOMS = 50;
const cancelledRoomIds = new Set<string>();

function recordCancelledRoom(roomId: string) {
  cancelledRoomIds.add(roomId);
  if (cancelledRoomIds.size > MAX_CANCELLED_ROOMS) {
    const oldest = cancelledRoomIds.values().next().value;
    if (oldest !== undefined) {
      cancelledRoomIds.delete(oldest);
    }
  }
}

export function _resetCancelledRoomsForTest() {
  cancelledRoomIds.clear();
}

async function getActiveCallRoomWithCaller(
  roomId: string,
  callerId: string
): Promise<{ id: string; chatId: string; participants?: Array<{ userId: string }> } | null> {
  try {
    const response = await services.callService.getRoom(roomId);
    if (!response?.room) return null;
    const isParticipant = Boolean(response.room.participants?.some((p) => p.userId === callerId));
    return isParticipant ? response.room : null;
  } catch {
    return null;
  }
}

async function findDirectChat(peerId: string, chatId?: string): Promise<IChatDto | null> {
  if (chatId) {
    const cachedDetail = queryClient.getQueryData<IChatDto>(chatKeys.detail(chatId));
    if (cachedDetail && cachedDetail.type === 'private' && cachedDetail.peerId === peerId) {
      return cachedDetail;
    }

    const cachedList = queryClient.getQueryData<IChatDto[]>(chatKeys.list());
    const fromList = cachedList?.find(
      (c) => c.id === chatId && c.type === 'private' && c.peerId === peerId
    );
    if (fromList) return fromList;

    try {
      const chat = await queryClient.ensureQueryData(chatQuery(chatId));
      if (chat && chat.type === 'private' && chat.peerId === peerId) {
        return chat;
      }
    } catch {
      // Игнорируем сетевую ошибку при получении чата
    }

    // Чат комнаты известен, но это не личный чат со звонящим (или он нам
    // недоступен) — дальше по списку не ищем: иначе любой личный чат с from
    // подменил бы чат комнаты, и её проверка ничего бы не ограничивала.
    return null;
  }

  let chats = queryClient.getQueryData<IChatDto[]>(chatKeys.list());
  let direct = chats?.find((c) => c.type === 'private' && c.peerId === peerId);
  if (direct) return direct;

  let archived = queryClient.getQueryData<IChatDto[]>(chatKeys.archived());
  direct = archived?.find((c) => c.type === 'private' && c.peerId === peerId);
  if (direct) return direct;

  try {
    chats = await queryClient.ensureQueryData(chatsQuery());
    direct = chats?.find((c) => c.type === 'private' && c.peerId === peerId);
    if (direct) return direct;
  } catch {
    // Игнорируем ошибку сети при получении чатов
  }

  try {
    archived = await queryClient.ensureQueryData(chatsQuery({ archived: true }));
    direct = archived?.find((c) => c.type === 'private' && c.peerId === peerId);
    if (direct) return direct;
  } catch {
    // Игнорируем ошибку сети при получении архива
  }

  return null;
}

async function resolveCallerInfo(
  callerId: string,
  directChat: IChatDto | null
): Promise<{ name?: string; avatar?: string | null }> {
  let profile = queryClient.getQueryData<{
    firstName?: string;
    lastName?: string;
    username?: string;
    avatarUrl?: string | null;
  }>(userKeys.profile(callerId));

  if (!profile) {
    try {
      profile = await queryClient.ensureQueryData(userProfileQuery(callerId));
    } catch {
      // Игнорируем сетевую ошибку профиля — fallback на directChat
    }
  }

  const profileName = formatCallerName(profile);
  const name = profileName || directChat?.title || undefined;
  const avatar = profile?.avatarUrl ?? directChat?.avatarUrl ?? null;

  return { name, avatar };
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
      fsm.state === 'outgoing' || (fsm.state === 'ended' && fsm.outgoingPhase != null)
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
      (fsm.state === 'connecting' ||
        fsm.state === 'active' ||
        fsm.state === 'reconnecting' ||
        fsm.state === 'outgoing') &&
      fsm.roomId
        ? {
            roomId: fsm.roomId,
            type: fsm.roomType,
            kind: fsm.callKind,
            title: fsm.title ?? undefined,
            chatId: fsm.chatId ?? undefined,
            peerId: fsm.peerId ?? undefined,
            peerName: fsm.peerName ?? fsm.title ?? undefined,
            peerAvatar: fsm.peerAvatar,
            isCaller: fsm.isCaller ?? false,
          }
        : null;

    const endedCall: IEndedCall | null =
      fsm.state === 'ended' && fsm.outgoingPhase == null && fsm.roomId
        ? {
            roomId: fsm.roomId,
            peerId: fsm.peerId ?? undefined,
            peerName: fsm.peerName ?? fsm.title ?? undefined,
            peerAvatar: fsm.peerAvatar,
            reason: fsm.endReason ?? 'completed',
          }
        : null;

    return { fsm, incomingCall, outgoingCall, activeCall, endedCall };
  };

  const clearCallTimeoutTimer = () => {
    const timer = get().callTimeoutTimer;
    if (timer) clearTimeout(timer);
    set({ callTimeoutTimer: null });
  };

  const clearReconnectTimer = () => {
    const timer = get().reconnectTimeoutTimer;
    if (timer) clearTimeout(timer);
    set({ reconnectTimeoutTimer: null });
  };

  const startReconnectTimer = () => {
    clearReconnectTimer();
    const timer = setTimeout(() => {
      if (get().fsm.state === 'reconnecting') {
        get().endCall('network_error');
      }
    }, RECONNECT_TIMEOUT_MS);
    set({ reconnectTimeoutTimer: timer });
  };

  const clearAllTimers = () => {
    clearCallTimeoutTimer();
    clearReconnectTimer();
    clearCallSession();
  };

  const clearTimer = clearAllTimers;

  return {
    fsm: initialCallContext,
    currentAttemptId: 0,
    isMinimized: false,
    socket: null,
    callTimeoutTimer: null,
    reconnectTimeoutTimer: null,
    incomingCall: null,
    outgoingCall: null,
    activeCall: null,
    endedCall: null,
    resumableCall: null,
    resumableSession: null,
    resumeExpiryTimer: null,

    attachSocket: (socket) => {
      set({ socket });
      if (socket?.isConnected) {
        get().rejoinActiveCall();
      }
    },

    rejoinActiveCall: () => {
      const { fsm, socket } = get();
      if (!socket?.isConnected || !fsm.roomId) return;
      if (fsm.state !== 'active' && fsm.state !== 'reconnecting') return;

      const profile = useProfileStore.getState().user;
      sendCallJoin(socket, {
        roomId: fsm.roomId,
        displayName: formatCallerName(profile),
        avatarUrl: profile?.avatarUrl,
        callKind: fsm.callKind,
        chatId: fsm.chatId ?? undefined,
        title: fsm.title ?? undefined,
      });
    },

    /* После перезагрузки страницы в звонок не входим сами (#775): показываем
       «Вернуться в звонок». Вход по нажатию — ещё и жест пользователя, без
       которого браузер не даст проиграть звук собеседника. Собеседник ждёт
       RECONNECT_TIMEOUT_MS с момента ухода со страницы — столько и живёт
       предложение вернуться. */
    restoreActiveSession: () => {
      const session = loadCallSession();
      if (!session) return false;
      if (get().fsm.state !== 'idle') return false;

      const expiresAt = (session.leftAt ?? Date.now()) + RECONNECT_TIMEOUT_MS;
      const left = expiresAt - Date.now();
      if (left <= 0) {
        clearCallSession();
        return false;
      }

      const previous = get().resumeExpiryTimer;
      if (previous) clearTimeout(previous);
      set({
        resumableSession: session,
        resumableCall: {
          roomId: session.roomId,
          peerId: session.peerId,
          peerName: session.peerName,
          peerAvatar: session.peerAvatar,
          callKind: session.callKind,
          expiresAt,
        },
        resumeExpiryTimer: setTimeout(() => get().dismissResumableCall(), left),
      });
      return true;
    },

    resumeCall: () => {
      const session = get().resumableSession;
      const timer = get().resumeExpiryTimer;
      if (timer) clearTimeout(timer);
      set({ resumableCall: null, resumableSession: null, resumeExpiryTimer: null });
      if (!session || get().fsm.state !== 'idle') return;

      const restoredFsm: ICallFsmContext = {
        state: 'reconnecting',
        roomId: session.roomId,
        peerId: session.peerId,
        peerName: session.peerName,
        peerAvatar: session.peerAvatar,
        callKind: session.callKind,
        roomType: session.roomType,
        title: session.title,
        endReason: null,
        callStartedAt: session.callStartedAt,
        outgoingPhase: null,
        isCaller: session.isCaller,
        chatId: session.chatId,
      };

      set(syncDerivedState(restoredFsm));
      startReconnectTimer();

      if (get().socket?.isConnected) {
        get().rejoinActiveCall();
      }
    },

    /* Не возвращаться: собеседник перестанет ждать по своему таймауту. */
    dismissResumableCall: () => {
      const timer = get().resumeExpiryTimer;
      if (timer) clearTimeout(timer);
      set({ resumableCall: null, resumableSession: null, resumeExpiryTimer: null });
      clearCallSession();
    },

    dispatch: (action) => {
      const currentFsm = get().fsm;
      const nextFsm = callStateReducer(currentFsm, action);
      if (nextFsm === currentFsm) return;

      /* Начался другой звонок — в прежний уже не вернуться. Сессию не
         трогаем: её перезапишет новый звонок. */
      const resumeTimer = get().resumeExpiryTimer;
      if (nextFsm.state !== 'idle' && get().resumableCall) {
        if (resumeTimer) clearTimeout(resumeTimer);
        set({ resumableCall: null, resumableSession: null, resumeExpiryTimer: null });
      }

      if (nextFsm.state === 'reconnecting' && currentFsm.state !== 'reconnecting') {
        startReconnectTimer();
      } else if (nextFsm.state !== 'reconnecting' && currentFsm.state === 'reconnecting') {
        clearReconnectTimer();
      }

      // Сохраняем сессию в sessionStorage для переживания перезагрузки страницы (F5)
      if (nextFsm.state === 'active') {
        if (nextFsm.roomId && nextFsm.peerId) {
          saveCallSession({
            roomId: nextFsm.roomId,
            peerId: nextFsm.peerId,
            peerName: nextFsm.peerName,
            peerAvatar: nextFsm.peerAvatar,
            callKind: nextFsm.callKind,
            roomType: nextFsm.roomType,
            callStartedAt: nextFsm.callStartedAt,
            isCaller: nextFsm.isCaller ?? false,
            chatId: nextFsm.chatId,
            title: nextFsm.title,
          });
        }
      } else if (nextFsm.state === 'ended' || nextFsm.state === 'idle') {
        clearCallSession();
        if (nextFsm.state === 'ended') {
          void queryClient.invalidateQueries({ queryKey: callKeys.historyAll() });
        }
      }

      set(syncDerivedState(nextFsm));
    },

    handleIncoming: async (payload) => {
      const { fsm, socket } = get();

      if (!payload.roomId || !payload.from) {
        return;
      }

      if (cancelledRoomIds.has(payload.roomId)) {
        cancelledRoomIds.delete(payload.roomId);
        return;
      }

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

      // 1. Проверяем комнату через GET /calls/rooms/{id} (#854)
      const room = await getActiveCallRoomWithCaller(payload.roomId, payload.from);
      if (!room) {
        return;
      }

      // 2. Входящий показывать только если есть личный чат с from (#854)
      const directChat = await findDirectChat(payload.from, room.chatId);
      if (!directChat) {
        return;
      }

      // 3. Проверка чёрного списка (#727, #773, #854)
      if (directChat.isPeerBlocked) {
        return;
      }
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

      // 4. Имя и аватар звонящего — из профиля / личного чата, но не из приглашения (#854)
      // Запрашиваем профиль ДО проверок отмены и FSM, чтобы все ожидания шли раньше финальных проверок
      const callerInfo = await resolveCallerInfo(payload.from, directChat);

      // 5. Проверяем, не была ли комната отменена за время асинхронных проверок (#854)
      if (cancelledRoomIds.has(payload.roomId)) {
        cancelledRoomIds.delete(payload.roomId);
        return;
      }

      // 6. Проверяем актуальное состояние FSM после асинхронных вызовов
      const currentFsm = get().fsm;
      if (currentFsm.state !== 'idle' && currentFsm.state !== 'ended') {
        // Если звенит та же комната (дубль при реконнекте сокета) — просто выходим без ложного busy
        if (currentFsm.roomId === payload.roomId) {
          return;
        }
        const currentSocket = get().socket;
        if (currentSocket?.isConnected && payload.from) {
          sendCallInviteResponse(currentSocket, {
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
          chatId: directChat.id,
          from: payload.from,
          fromName: callerInfo.name,
          fromAvatar: callerInfo.avatar,
          kind: payload.kind,
        },
      });

      const soundsEnabled = useProfileStore.getState().settings.sounds;
      if (soundsEnabled !== false) {
        startRingtone();
      }
    },

    handleCancelled: (payload) => {
      const roomId = typeof payload === 'string' ? payload : payload.roomId;
      if (roomId) {
        recordCancelledRoom(roomId);
      }
      const { fsm } = get();
      if (fsm.roomId === roomId) {
        stopRingtone();
        clearTimer();
        const finishedRoomId = fsm.roomId;
        get().dispatch({ type: 'END_CALL', reason: 'peer_ended' });
        setTimeout(() => {
          if (get().fsm.state === 'ended' && get().fsm.roomId === finishedRoomId) {
            get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
          }
        }, 1500);
      }
    },

    handleBroadcastEvent: (event) => {
      const { fsm } = get();
      if (fsm.state === 'incoming' && (!event.roomId || fsm.roomId === event.roomId)) {
        stopRingtone();
        clearTimer();
        get().dispatch({ type: 'END_CALL', reason: 'cancelled' });
        get().dispatch({ type: 'RESET_TO_IDLE', roomId: event.roomId });
      }
    },

    handleInviteResponse: (payload) => {
      const { fsm } = get();
      if (fsm.roomId !== payload.roomId) return;
      if (fsm.state !== 'outgoing') return;
      if (!payload.from || payload.from !== fsm.peerId) return;

      clearTimer();

      if (payload.accepted) {
        get().dispatch({ type: 'PEER_ACCEPTED' });
      } else {
        const reason: TCallEndReason = payload.reason === 'busy' ? 'busy' : 'declined';
        get().dispatch({ type: 'SET_OUTGOING_PHASE', phase: reason });
        const finishedRoomId = fsm.roomId ?? undefined;
        const attemptId = get().currentAttemptId;
        get().dispatch({ type: 'END_CALL', reason });
        setTimeout(() => {
          if (get().currentAttemptId === attemptId && get().fsm.state === 'ended') {
            get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
          }
        }, 1500);
      }
    },

    initiateCall: async (chatId, type, title, kind, peerId, peerAvatar, peerName) => {
      const { socket, fsm } = get();
      if (fsm.state !== 'idle' && fsm.state !== 'ended') return;

      clearTimer();
      const attemptId = get().currentAttemptId + 1;
      set({ currentAttemptId: attemptId });

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

        // Проверяем, не отменил ли пользователь вызов или не запустил ли новый
        if (get().currentAttemptId !== attemptId || get().fsm.state !== 'outgoing') {
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

        if (socket?.isConnected) {
          const profile = useProfileStore.getState().user;
          sendCallJoin(socket, {
            roomId,
            displayName: formatCallerName(profile),
            avatarUrl: profile?.avatarUrl,
            callKind: kind,
            chatId,
            title,
          });

          if (targetPeerId) {
            sendCallInvite(socket, {
              to: targetPeerId,
              roomId,
              kind,
              fromName: formatCallerName(profile),
              fromAvatar: profile?.avatarUrl,
              title,
            });
          }
        }

        // Таймер ожидания ответа 60 секунд
        const timer = setTimeout(() => {
          get().handleOutgoingTimeout();
        }, CALL_TIMEOUT_MS);
        set({ callTimeoutTimer: timer });
      } catch {
        if (get().currentAttemptId === attemptId && get().fsm.state === 'outgoing') {
          get().dispatch({ type: 'SET_OUTGOING_PHASE', phase: 'failed' });
          get().dispatch({ type: 'END_CALL', reason: 'network_error' });
          setTimeout(() => {
            if (get().currentAttemptId === attemptId && get().fsm.state === 'ended') {
              get().dispatch({ type: 'RESET_TO_IDLE' });
            }
          }, 1500);
        }
      }
    },

    cancelCall: () => {
      clearAllTimers();
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
      const attemptId = get().currentAttemptId;
      get().dispatch({ type: 'END_CALL', reason: 'cancelled' });
      setTimeout(() => {
        if (get().currentAttemptId === attemptId && get().fsm.state === 'ended') {
          get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
        }
      }, 400);
    },

    handleOutgoingTimeout: () => {
      const { fsm, socket } = get();
      if (fsm.state !== 'outgoing') return;

      clearAllTimers();
      if (socket?.isConnected && fsm.roomId) {
        sendCallLeave(socket, fsm.roomId);
      }

      get().dispatch({ type: 'SET_OUTGOING_PHASE', phase: 'no_answer' });
      const finishedRoomId = fsm.roomId ?? undefined;
      const attemptId = get().currentAttemptId;
      get().dispatch({ type: 'END_CALL', reason: 'no_answer' });
      setTimeout(() => {
        if (get().currentAttemptId === attemptId && get().fsm.state === 'ended') {
          get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
        }
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

        const profile = useProfileStore.getState().user;
        sendCallJoin(socket, {
          roomId: fsm.roomId,
          displayName: formatCallerName(profile),
          avatarUrl: profile?.avatarUrl,
          callKind: fsm.callKind,
          chatId: fsm.chatId ?? undefined,
          title: fsm.title ?? undefined,
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
        if (get().fsm.state === 'ended' && get().fsm.roomId === finishedRoomId) {
          get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
        }
      }, 500);
    },

    endCall: (reason: TCallEndReason = 'completed') => {
      stopRingtone();
      clearAllTimers();
      const { fsm, socket } = get();

      if (socket?.isConnected && fsm.roomId) {
        sendCallLeave(socket, fsm.roomId);
      }

      const finishedRoomId = fsm.roomId ?? undefined;
      get().dispatch({ type: 'END_CALL', reason });

      setTimeout(() => {
        if (
          get().fsm.state === 'ended' &&
          (!finishedRoomId || get().fsm.roomId === finishedRoomId)
        ) {
          get().dispatch({ type: 'RESET_TO_IDLE', roomId: finishedRoomId });
          if (get().fsm.state === 'idle') {
            set({ isMinimized: false });
          }
        }
      }, 1200);
    },

    minimizeCall: () => set({ isMinimized: true }),
    maximizeCall: () => set({ isMinimized: false }),
  };
});
