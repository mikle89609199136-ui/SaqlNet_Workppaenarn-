import { WS_EVENTS } from "@/consts";
import { services, startRingtone, stopRingtone, WebSocketClient } from "@/services";
import type {
  IActiveCall,
  ICallInviteResponsePayload,
  IIncomingCall,
  IMemberDto,
  TCallKind,
  TCallRoomType,
} from "@/types";
import { create } from "zustand";

interface CallStore {
  incomingCall: IIncomingCall | null;
  activeCall: IActiveCall | null;
  isMinimized: boolean;
  socket: WebSocketClient | null;
  callFrameRef: HTMLIFrameElement | null;

  attachSocket: (socket: WebSocketClient | null) => void;
  attachCallFrame: (callFrameRef: HTMLIFrameElement | null) => void;

  handleIncoming: (payload: IIncomingCall) => void;
  handleCancelled: (roomId: string) => void;
  handleInviteResponse: (payload: ICallInviteResponsePayload) => void;

  acceptCall: () => void;
  rejectCall: () => void;
  initiateCall: (
    chatId: string,
    type: TCallRoomType,
    title: string,
    kind: TCallKind,
    peerId?: string | null,
  ) => Promise<void>;
  endCall: () => void;
  minimizeCall: () => void;
  maximizeCall: () => void;
}

function postHangup(frame: HTMLIFrameElement | null): void {
  try {
    frame?.contentWindow?.postMessage({ type: "crane_hangup" }, "*");
  } catch {}
}

function readLocalUser(): {
  id?: string;
  firstName?: string;
  username?: string;
  avatarUrl?: string;
} {
  try {
    return JSON.parse(localStorage.getItem("craneapp_user_data") || "{}");
  } catch {
    return {};
  }
}

export const useCallStore = create<CallStore>((set, get) => ({
  incomingCall: null,
  activeCall: null,
  isMinimized: false,
  socket: null,
  callFrameRef: null,

  attachSocket: (socket) => set({ socket }),
  attachCallFrame: (callFrameRef) => set({ callFrameRef }),

  handleIncoming: (payload) => {
    const { activeCall, incomingCall, socket } = get();
    if (activeCall || incomingCall) {
      if (socket?.isConnected) {
        socket.send({
          type: WS_EVENTS.CALL.INVITE_RESPONSE,
          to: payload.from,
          roomId: payload.roomId,
          accepted: false,
          reason: "busy",
        });
      }
      return;
    }
    set({ incomingCall: payload });
    startRingtone();
  },

  handleCancelled: (roomId) => {
    const { incomingCall } = get();
    if (incomingCall && incomingCall.roomId === roomId) {
      set({ incomingCall: null });
      stopRingtone();
    }
  },

  handleInviteResponse: (payload) => {
    const { activeCall, callFrameRef } = get();
    if (
      !activeCall ||
      payload.roomId !== activeCall.roomId ||
      payload.accepted
    ) {
      return;
    }
    postHangup(callFrameRef);
    set({ activeCall: null, isMinimized: false });
  },

  acceptCall: () => {
    const { incomingCall, socket } = get();
    if (!incomingCall) return;
    stopRingtone();

    if (socket?.isConnected) {
      socket.send({
        type: WS_EVENTS.CALL.INVITE_RESPONSE,
        to: incomingCall.from,
        roomId: incomingCall.roomId,
        accepted: true,
      });
    }

    set({
      activeCall: {
        roomId: incomingCall.roomId,
        type: incomingCall.callType || "private",
        kind: incomingCall.kind,
        title: incomingCall.title || incomingCall.fromName || "",
      },
      incomingCall: null,
    });
  },

  rejectCall: () => {
    const { incomingCall, socket } = get();
    if (!incomingCall) return;
    stopRingtone();

    if (socket?.isConnected) {
      socket.send({
        type: WS_EVENTS.CALL.INVITE_RESPONSE,
        to: incomingCall.from,
        roomId: incomingCall.roomId,
        accepted: false,
        reason: "rejected",
      });
    }

    set({ incomingCall: null });
  },

  initiateCall: async (chatId, type, title, kind, peerId = null) => {
    const { activeCall, incomingCall, socket } = get();
    if (activeCall || incomingCall) return;

    try {
      const callType: TCallRoomType = type === "group" ? "group" : "private";
      const room = await services.callService.createRoom({
        type: callType,
        chatId,
        title,
        callKind: kind,
      });
      const roomId: string | undefined = room?.id;
      if (!roomId) throw new Error("Room creation failed");

      if (socket?.isConnected) {
        let targets: string[] = [];
        const user = readLocalUser();

        if (callType !== "group") {
          if (peerId) targets = [peerId];
        } else {
          const members = await services.chatService.getMembers(chatId);
          targets = members
            .map((m: IMemberDto) => m.id)
            .filter((id: string) => id && id !== user.id);
        }

        targets.forEach((to) =>
          socket.send({
            type: "call_invite",
            to,
            roomId,
            kind,
            fromName: user.firstName || user.username,
            fromAvatar: user.avatarUrl || null,
            title,
          }),
        );
      }

      set({
        activeCall: { roomId, type: callType, kind, title, chatId },
        isMinimized: false,
      });
    } catch (err) {
      console.error("Call initiation failed:", err);
      alert("Не удалось начать звонок");
    }
  },

  endCall: () => {
    const { activeCall, callFrameRef } = get();
    if (!activeCall) return;
    postHangup(callFrameRef);
    set({ activeCall: null, isMinimized: false });
  },

  minimizeCall: () => set({ isMinimized: true }),
  maximizeCall: () => set({ isMinimized: false }),
}));