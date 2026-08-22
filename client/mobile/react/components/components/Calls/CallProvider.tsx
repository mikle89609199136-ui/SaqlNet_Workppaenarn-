import { WS_EVENTS } from "@/consts";
import { useRealtimeSocket } from "@/hooks";
import { useCallStore } from "@/store";
import type {
  ICallCancelledPayload,
  ICallInviteResponsePayload,
  IIncomingCall,
} from "@/types";
import { useEffect, type PropsWithChildren } from "react";

export function CallProvider({ children }: PropsWithChildren) {
  const { socket, eventBus } = useRealtimeSocket();

  useEffect(() => {
    useCallStore.getState().attachSocket(socket ?? null);
  }, [socket]);

  useEffect(() => {
    const unsubIncoming = eventBus.on(
      WS_EVENTS.CALL.INCOMING,
      (payload: IIncomingCall) =>
        useCallStore.getState().handleIncoming(payload),
    );
    const unsubCancelled = eventBus.on(
      WS_EVENTS.CALL.CANCELED,
      (payload: ICallCancelledPayload) =>
        useCallStore.getState().handleCancelled(payload.roomId),
    );
    const unsubInviteResponse = eventBus.on(
      WS_EVENTS.CALL.INVITE_RESPONSE,
      (payload: ICallInviteResponsePayload) =>
        useCallStore.getState().handleInviteResponse(payload),
    );

    return () => {
      unsubIncoming();
      unsubCancelled();
      unsubInviteResponse();
    };
  }, [eventBus]);

  useEffect(() => {
    function handleIframeMessage(e: MessageEvent): void {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "crane_call_ended") {
        useCallStore.setState({ activeCall: null, isMinimized: false });
      }
      if (e.data.type === "crane_call_minimize") {
        useCallStore.setState({ isMinimized: true });
      }
    }

    window.addEventListener("message", handleIframeMessage);
    return () => window.removeEventListener("message", handleIframeMessage);
  }, []);

  return <>{children}</>;
}