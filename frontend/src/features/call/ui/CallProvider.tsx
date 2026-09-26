import { useEffect, type PropsWithChildren } from 'react';
import { WS_EVENTS } from '@/shared/config';
import { useRealtimeSocket } from '@/shared/api';
import { useCallStore } from '../model/callStore';
import type {
  ICallCancelledEvent,
  ICallIncomingEvent,
  ICallInviteResponseEvent,
  ICallJoinedEvent,
  ICallPeerJoinedEvent,
  ICallPeerLeftEvent,
} from '@/types';

export function CallProvider({ children }: PropsWithChildren) {
  const { socket, eventBus } = useRealtimeSocket();

  useEffect(() => {
    useCallStore.getState().attachSocket(socket ?? null);
  }, [socket]);

  useEffect(() => {
    const unsubIncoming = eventBus.on(WS_EVENTS.CALL.INCOMING, (payload: ICallIncomingEvent) => {
      useCallStore.getState().handleIncoming(payload);
    });

    const unsubCancelled = eventBus.on(WS_EVENTS.CALL.CANCELED, (payload: ICallCancelledEvent) => {
      useCallStore.getState().handleCancelled(payload);
    });

    const unsubInviteResponse = eventBus.on(
      WS_EVENTS.CALL.INVITE_RESPONSE,
      (payload: ICallInviteResponseEvent) => {
        useCallStore.getState().handleInviteResponse(payload);
      }
    );

    const unsubJoined = eventBus.on(WS_EVENTS.CALL.JOINED, (payload: ICallJoinedEvent) => {
      const { fsm } = useCallStore.getState();
      if (
        fsm.roomId &&
        payload.roomId === fsm.roomId &&
        payload.peers &&
        payload.peers.length > 0
      ) {
        useCallStore.getState().dispatch({ type: 'PEER_JOINED' });
      }
    });

    const unsubPeerJoined = eventBus.on(
      WS_EVENTS.CALL.PEER_JOINED,
      (payload: ICallPeerJoinedEvent) => {
        const { fsm } = useCallStore.getState();
        if (fsm.roomId && payload.roomId === fsm.roomId) {
          useCallStore.getState().dispatch({ type: 'PEER_JOINED' });
        }
      }
    );

    const unsubPeerLeft = eventBus.on(WS_EVENTS.CALL.PEER_LEFT, (payload: ICallPeerLeftEvent) => {
      const { fsm } = useCallStore.getState();
      if (fsm.roomId && payload.roomId === fsm.roomId) {
        useCallStore.getState().endCall('peer_ended');
      }
    });

    return () => {
      unsubIncoming();
      unsubCancelled();
      unsubInviteResponse();
      unsubJoined();
      unsubPeerJoined();
      unsubPeerLeft();
    };
  }, [eventBus]);

  useEffect(() => {
    function handleIframeMessage(e: MessageEvent): void {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'crane_call_ended') {
        useCallStore.getState().endCall('completed');
      }
      if (e.data.type === 'crane_call_minimize') {
        useCallStore.getState().minimizeCall();
      }
    }

    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, []);

  return <>{children}</>;
}
