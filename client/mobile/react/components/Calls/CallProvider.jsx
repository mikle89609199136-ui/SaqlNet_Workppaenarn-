import { useEffect, useState } from "react";
import { CallContext } from "../../hooks/useCall.js";
import { useRealtimeSocket } from "../../hooks/useRealtimeSocket.js";
import services from "../../services/serviceContainer.js";


export function CallProvider({ children }) {
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const { socket, eventBus } = useRealtimeSocket();

  // Рингтон через WebAudio
  const [ringtone, setRingtone] = useState(null);

  function sendInviteResponse(call, accepted, reason = null) {
    try {
      if (socket && socket.isConnected && call?.from) {
        socket.send({
          type: "call_invite_response",
          to: call.from,
          roomId: call.roomId,
          accepted,
          ...(reason ? { reason } : {}),
        });
      }
    } catch (err) {
      console.warn("Failed to send call invite response:", err);
    }
  }

  function startRingtone() {
    stopRingtone();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ringtoneTimer = setInterval(() => {
        if (!ctx) return;
        const t0 = ctx.currentTime;
        [0, 0.5].forEach((offset) => {
          const o1 = ctx.createOscillator();
          const g1 = ctx.createGain();
          o1.type = "sine";
          o1.frequency.value = 440;
          g1.gain.setValueAtTime(0, t0 + offset);
          g1.gain.linearRampToValueAtTime(0.55, t0 + offset + 0.04);
          g1.gain.setValueAtTime(0.55, t0 + offset + 0.32);
          g1.gain.linearRampToValueAtTime(0, t0 + offset + 0.4);

          const o2 = ctx.createOscillator();
          const g2 = ctx.createGain();
          o2.type = "sine";
          o2.frequency.value = 480;
          g2.gain.setValueAtTime(0, t0 + offset);
          g2.gain.linearRampToValueAtTime(0.45, t0 + offset + 0.04);
          g2.gain.setValueAtTime(0.45, t0 + offset + 0.32);
          g2.gain.linearRampToValueAtTime(0, t0 + offset + 0.4);

          o1.connect(g1).connect(ctx.destination);
          o2.connect(g2).connect(ctx.destination);

          o1.start(t0 + offset);
          o1.stop(t0 + offset + 0.42);
          o2.start(t0 + offset);
          o2.stop(t0 + offset + 0.42);
        });
      }, 2000);

      // Вибрация
      let vibrateTimer = null;
      if (navigator.vibrate) {
        navigator.vibrate([400, 200, 400, 1000]);
        vibrateTimer = setInterval(() => {
          navigator.vibrate([400, 200, 400, 1000]);
        }, 2000);
      }

      setRingtone({ ctx, ringtoneTimer, vibrateTimer });
    } catch (e) {
      console.warn("Ringtone failed:", e);
    }
  }

  function stopRingtone() {
    if (ringtone) {
      clearInterval(ringtone.ringtoneTimer);
      if (ringtone.vibrateTimer) clearInterval(ringtone.vibrateTimer);
      try {
        if (navigator.vibrate) navigator.vibrate(0);
      } catch (_) {}
      try {
        ringtone.ctx.close();
      } catch (_) {}
      setRingtone(null);
    }
  }

  // Подписка на сокет-события через eventBus
  useEffect(() => {
    const unsubIncoming = eventBus.on("call_incoming", (payload) => {
      // payload: { roomId, from, fromName, fromAvatar, kind, title }
      if (activeCall || incomingCall) {
        sendInviteResponse(payload, false, "busy");
        return;
      }
      setIncomingCall(payload);
      startRingtone();
    });

    const unsubCancelled = eventBus.on("call_cancelled", (payload) => {
      if (incomingCall && incomingCall.roomId === payload.roomId) {
        setIncomingCall(null);
        stopRingtone();
      }
    });

    const unsubInviteResponse = eventBus.on(
      "call_invite_response",
      (payload) => {
        if (
          !activeCall ||
          payload?.roomId !== activeCall.roomId ||
          payload?.accepted
        )
          return;
        try {
          const frame = document.getElementById("callFrame");
          frame?.contentWindow?.postMessage({ type: "crane_hangup" }, "*");
        } catch (_) {}
        setActiveCall(null);
        setIsMinimized(false);
      },
    );

    return () => {
      unsubIncoming();
      unsubCancelled();
      unsubInviteResponse();
    };
  }, [activeCall, incomingCall, ringtone, socket]);

  // Слушатель сообщений от iframe
  useEffect(() => {
    function handleIframeMessage(e) {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "crane_call_ended") {
        setActiveCall(null);
        setIsMinimized(false);
      }
      if (e.data.type === "crane_call_minimize") {
        setIsMinimized(true);
      }
    }

    window.addEventListener("message", handleIframeMessage);
    return () => window.removeEventListener("message", handleIframeMessage);
  }, []);

  function acceptCall() {
    if (!incomingCall) return;
    stopRingtone();

    // Отправка ответа инициатору через сокет
    sendInviteResponse(incomingCall, true);

    setActiveCall({
      roomId: incomingCall.roomId,
      type: incomingCall.callType || "p2p",
      kind: incomingCall.kind,
      title: incomingCall.title || incomingCall.fromName,
    });
    setIncomingCall(null);
  }

  function rejectCall() {
    if (!incomingCall) return;
    stopRingtone();

    sendInviteResponse(incomingCall, false, "rejected");

    setIncomingCall(null);
  }

  async function initiateCall(chatId, type, title, kind, peerId = null) {
    if (activeCall || incomingCall) return;

    // 1. Создаем комнату звонка через API
    try {
      const callType = type === "group" ? "group" : "p2p";
      const room = await services.callService.createRoom({
        type: callType,
        chatId,
        title,
        callKind: kind,
      });
      const roomId = room.id;
      if (!roomId) throw new Error("Room creation failed");

      // 2. Отправляем приглашение через сокет участникам
      if (socket && socket.isConnected) {
        let targets = [];
        const userStr = localStorage.getItem("craneapp_user_data") || "{}";
        const user = JSON.parse(userStr);

        if (callType !== "group") {
          // Личный чат
          if (peerId) targets = [peerId];
        } else {
          // Для группы запрашиваем участников
          const members = await services.chatService.getMembers(chatId);
          targets = members
            .map((m) => m.id)
            .filter((id) => id && id !== user.id);
        }

        const invitePayloads = targets.map((to) => ({
          type: "call_invite",
          to,
          roomId,
          kind,
          fromName: user.firstName || user.username,
          fromAvatar: user.avatarUrl || null,
          title,
        }));

        invitePayloads.forEach((p) => socket.send(p));
      }

      setActiveCall({ roomId, type: callType, kind, title, chatId });
      setIsMinimized(false);
    } catch (err) {
      console.error("Call initiation failed:", err);
      alert("Не удалось начать звонок");
    }
  }

  function endCall() {
    if (!activeCall) return;
    try {
      const frame = document.getElementById("callFrame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: "crane_hangup" }, "*");
      }
    } catch (_) {}
    setActiveCall(null);
    setIsMinimized(false);
  }

  return (
    <CallContext.Provider
      value={{
        incomingCall,
        activeCall,
        isMinimized,
        acceptCall,
        rejectCall,
        initiateCall,
        endCall,
        minimizeCall: () => setIsMinimized(true),
        maximizeCall: () => setIsMinimized(false),
      }}
    >
      {children}
    </CallContext.Provider>
  );
}


