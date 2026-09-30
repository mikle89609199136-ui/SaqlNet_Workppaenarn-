import { useEffect, type PropsWithChildren } from 'react';
import { WS_EVENTS } from '@/shared/config';
import { useRealtimeSocket } from '@/shared/api';
import { useCallStore } from '../model/callStore';
import { subscribeCallBroadcast } from '../model/callBroadcast';
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
    useCallStore.getState().restoreActiveSession();
  }, []);

  useEffect(() => {
    const unsubBroadcast = subscribeCallBroadcast((event) => {
      useCallStore.getState().handleBroadcastEvent(event);
    });
    return unsubBroadcast;
  }, []);

  useEffect(() => {
    const unsubIncoming = eventBus.on(WS_EVENTS.CALL.INCOMING, (payload: ICallIncomingEvent) => {
      void useCallStore.getState().handleIncoming(payload);
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

    const unsubSocketConnected = eventBus.on(WS_EVENTS.SOCKET.CONNECTED, () => {
      useCallStore.getState().rejoinActiveCall();
    });

    const unsubCallError = eventBus.on(
      WS_EVENTS.CALL.ERROR,
      (payload?: { roomId?: string; message?: string }) => {
        const { fsm } = useCallStore.getState();
        if (fsm.roomId && (!payload?.roomId || payload.roomId === fsm.roomId)) {
          useCallStore.getState().endCall('network_error');
        }
      }
    );

    return () => {
      unsubIncoming();
      unsubCancelled();
      unsubInviteResponse();
      unsubJoined();
      unsubPeerJoined();
      unsubPeerLeft();
      unsubSocketConnected();
      unsubCallError();
    };
  }, [eventBus]);

  return <>{children}</>;
}
