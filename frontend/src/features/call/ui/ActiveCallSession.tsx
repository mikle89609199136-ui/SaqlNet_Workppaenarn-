import { useEffect, useRef } from 'react';
import { useCallStore } from '../model/callStore';
import { useLocalMedia } from '../model/useLocalMedia';
import { usePeerConnection } from '../model/usePeerConnection';
import type { IActiveCall } from '../model/types';
import { ActiveCallView } from './ActiveCallView';
import { MinimizedCallBar } from './MinimizedCallBar';

export interface IActiveCallSessionProps {
  activeCall: IActiveCall;
  isMinimized: boolean;
  localMedia?: ReturnType<typeof useLocalMedia>;
  peerConnection?: ReturnType<typeof usePeerConnection>;
}

export function ActiveCallSession({
  activeCall,
  isMinimized,
  localMedia: customLocalMedia,
  peerConnection: customPeerConnection,
}: IActiveCallSessionProps) {
  const defaultLocalMedia = useLocalMedia();
  const localMedia = customLocalMedia ?? defaultLocalMedia;
  const socket = useCallStore((s) => s.socket);
  const fsm = useCallStore((s) => s.fsm);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const { startMedia, manager: localMediaManager } = localMedia;

  // Инициализация локального медиа при старте звонка
  useEffect(() => {
    if (customLocalMedia) return;
    void startMedia({
      audio: true,
      video: activeCall.kind === 'video',
    });
    // При размонтировании stopMedia вызовется автоматически внутри useLocalMedia
  }, [activeCall.kind, startMedia, customLocalMedia]);

  // Callee — polite (true), Caller — impolite (false)
  const isPolite = !activeCall.isCaller;

  const defaultPeerConnection = usePeerConnection({
    socket,
    roomId: activeCall.roomId,
    peerId: activeCall.peerId ?? fsm.peerId ?? '',
    isPolite,
    localStream: localMedia.stream,
    autoConnect: !customPeerConnection,
  });

  const peerConnection = customPeerConnection ?? defaultPeerConnection;

  const { replaceTrack } = peerConnection;

  // Воспроизведение звука собеседника через постоянный audio-элемент (живет всю сессию звонка)
  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = peerConnection.remoteStream;
    }
  }, [peerConnection.remoteStream]);

  // При смене трека (например, переключение камеры) пробрасываем в WebRTC sender
  useEffect(() => {
    return localMediaManager.onTrackReplaced((kind, track) => {
      replaceTrack(kind, track);
    });
  }, [localMediaManager, replaceTrack]);

  // Переход callee в active при установке WebRTC-соединения (#774 / #813)
  useEffect(() => {
    if (
      peerConnection.connectionState === 'connected' &&
      useCallStore.getState().fsm.state === 'connecting'
    ) {
      useCallStore.getState().dispatch({ type: 'PEER_JOINED' });
    }
  }, [peerConnection.connectionState]);

  // Обработка потери и восстановления связи
  useEffect(() => {
    const connState = peerConnection.connectionState;
    const currentState = useCallStore.getState().fsm.state;

    if ((connState === 'disconnected' || connState === 'failed') && currentState === 'active') {
      useCallStore.getState().dispatch({ type: 'CONNECTION_LOST' });
    } else if (connState === 'connected' && currentState === 'reconnecting') {
      useCallStore.getState().dispatch({ type: 'CONNECTION_RESTORED' });
    }
  }, [peerConnection.connectionState]);

  const handleToggleAudio = () => localMedia.toggleAudio();
  const handleToggleVideo = () => localMedia.toggleVideo();
  const handleSwitchCamera = () => void localMedia.switchCamera();
  const handleMinimize = () => useCallStore.getState().minimizeCall();
  const handleMaximize = () => useCallStore.getState().maximizeCall();
  const handleEndCall = () => useCallStore.getState().endCall('completed');

  const effectiveConnectionState =
    fsm.state === 'reconnecting' ? 'reconnecting' : peerConnection.connectionState;

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" aria-hidden="true" />
      {isMinimized ? (
        <MinimizedCallBar
          activeCall={activeCall}
          connectionState={effectiveConnectionState}
          callStartedAt={fsm.callStartedAt}
          isAudioEnabled={!localMedia.isAudioMuted}
          isVideoEnabled={!localMedia.isVideoMuted}
          onMaximize={handleMaximize}
          onEndCall={handleEndCall}
        />
      ) : (
        <ActiveCallView
          activeCall={activeCall}
          localStream={localMedia.stream}
          remoteStream={peerConnection.remoteStream}
          connectionState={effectiveConnectionState}
          isAudioEnabled={!localMedia.isAudioMuted}
          isVideoEnabled={!localMedia.isVideoMuted}
          facingMode={localMedia.facingMode}
          availableCamerasCount={localMedia.videoInputs.length}
          mediaError={localMedia.error}
          callStartedAt={fsm.callStartedAt}
          onToggleAudio={handleToggleAudio}
          onToggleVideo={handleToggleVideo}
          onSwitchCamera={handleSwitchCamera}
          onMinimize={handleMinimize}
          onEndCall={handleEndCall}
        />
      )}
    </>
  );
}
