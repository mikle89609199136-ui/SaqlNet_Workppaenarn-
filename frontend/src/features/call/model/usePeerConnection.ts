import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebSocketClient } from '@/services/WebSocketClient';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/shared/lib/event-bus';
import type { ICallAnswerEvent, ICallIceEvent, ICallOfferEvent } from '@/types';
import { PeerConnectionManager, type IPeerConnectionOptions } from './peerConnection';

export interface IUsePeerConnectionOptions extends Omit<IPeerConnectionOptions, 'socket'> {
  socket: WebSocketClient | null;
  autoConnect?: boolean;
}

export function usePeerConnection(options: IUsePeerConnectionOptions) {
  const {
    socket,
    roomId,
    peerId,
    isPolite,
    iceServers,
    localStream,
    autoConnect = true,
    onRemoteStream,
    onRemoteTrack,
    onConnectionStateChange,
    onError,
  } = options;

  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [manager, setManager] = useState<PeerConnectionManager | null>(null);
  const managerRef = useRef<PeerConnectionManager | null>(null);

  const callbacksRef = useRef({
    onRemoteStream,
    onRemoteTrack,
    onConnectionStateChange,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onRemoteStream,
      onRemoteTrack,
      onConnectionStateChange,
      onError,
    };
    managerRef.current?.updateOptions({
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        callbacksRef.current.onRemoteStream?.(stream);
      },
      onRemoteTrack: (track, stream) => {
        callbacksRef.current.onRemoteTrack?.(track, stream);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        callbacksRef.current.onConnectionStateChange?.(state);
      },
      onError: (err) => {
        callbacksRef.current.onError?.(err);
      },
    });
  }, [onRemoteStream, onRemoteTrack, onConnectionStateChange, onError]);

  const unsubRef = useRef<(() => void) | null>(null);
  const localStreamRef = useRef(localStream);
  const iceServersRef = useRef(iceServers);

  useEffect(() => {
    iceServersRef.current = iceServers;
  }, [iceServers]);

  useEffect(() => {
    if (!socket || !roomId || !peerId || !autoConnect) {
      if (managerRef.current) {
        managerRef.current.close();
        managerRef.current = null;
        setManager(null);
      }
      return;
    }

    const nextManager = new PeerConnectionManager({
      socket,
      roomId,
      peerId,
      isPolite,
      iceServers: iceServersRef.current,
      localStream: localStreamRef.current,
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        callbacksRef.current.onRemoteStream?.(stream);
      },
      onRemoteTrack: (track, stream) => {
        callbacksRef.current.onRemoteTrack?.(track, stream);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        callbacksRef.current.onConnectionStateChange?.(state);
      },
      onError: (err) => {
        callbacksRef.current.onError?.(err);
      },
    });

    managerRef.current = nextManager;
    setManager(nextManager);

    void nextManager.initialize();

    const unsubOffer = eventBus.on(WS_EVENTS.CALL.OFFER, (event: ICallOfferEvent) => {
      if (event.roomId === roomId && event.from === peerId) {
        const payload =
          event.payload ??
          ({
            type: (event as unknown as { type: RTCSdpType }).type,
            sdp: (event as unknown as { sdp: string }).sdp,
          } as RTCSessionDescriptionInit);
        void nextManager.handleRemoteOffer(payload);
      }
    });

    const unsubAnswer = eventBus.on(WS_EVENTS.CALL.ANSWER, (event: ICallAnswerEvent) => {
      if (event.roomId === roomId && event.from === peerId) {
        const payload =
          event.payload ??
          ({
            type: (event as unknown as { type: RTCSdpType }).type,
            sdp: (event as unknown as { sdp: string }).sdp,
          } as RTCSessionDescriptionInit);
        void nextManager.handleRemoteAnswer(payload);
      }
    });

    const unsubIce = eventBus.on(WS_EVENTS.CALL.ICE, (event: ICallIceEvent) => {
      if (event.roomId === roomId && event.from === peerId) {
        const payload = event.payload ?? (event as unknown as RTCIceCandidateInit);
        void nextManager.handleRemoteIce(payload);
      }
    });

    const unsub = () => {
      unsubOffer();
      unsubAnswer();
      unsubIce();
      nextManager.close();
      if (managerRef.current === nextManager) {
        managerRef.current = null;
        setManager(null);
      }
    };
    unsubRef.current = unsub;

    return () => {
      unsub();
      if (unsubRef.current === unsub) {
        unsubRef.current = null;
      }
    };
  }, [socket, roomId, peerId, isPolite, autoConnect, connectionEpoch]);

  // Синхронизация локального стрима при его изменении (включая сброс в null)
  useEffect(() => {
    localStreamRef.current = localStream;
    if (managerRef.current) {
      managerRef.current.setLocalStream(localStream ?? null);
    }
  }, [localStream]);

  const replaceTrack = useCallback(
    (kind: 'audio' | 'video', newTrack: MediaStreamTrack | null) =>
      managerRef.current?.replaceTrack(kind, newTrack),
    []
  );

  const restartIce = useCallback(async () => {
    await managerRef.current?.restartIce();
  }, []);

  const resetConnection = useCallback(() => {
    unsubRef.current?.();
    setConnectionState('new');
    setRemoteStream(null);
    setConnectionEpoch((v) => v + 1);
  }, []);

  const close = useCallback(() => {
    unsubRef.current?.();
  }, []);

  return {
    connectionState,
    remoteStream,
    manager,
    replaceTrack,
    restartIce,
    resetConnection,
    close,
  };
}
