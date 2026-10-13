import { useEffect, useRef } from 'react';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/shared/lib/event-bus';
import type { ICallJoinedEvent, ICallPeerJoinedEvent } from '@/types';
import type { ICallAudioEnvironment } from '../model/callAudioPipeline';
import { useCallAudioPipeline } from '../model/useCallAudioPipeline';
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
  /** Окружение обработки звука — для тестов; по умолчанию браузерное. */
  audioEnvironment?: ICallAudioEnvironment;
}

export function ActiveCallSession({
  activeCall,
  isMinimized,
  localMedia: customLocalMedia,
  peerConnection: customPeerConnection,
  audioEnvironment,
}: IActiveCallSessionProps) {
  const defaultLocalMedia = useLocalMedia();
  const localMedia = customLocalMedia ?? defaultLocalMedia;
  const socket = useCallStore((s) => s.socket);
  const fsm = useCallStore((s) => s.fsm);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const { startMedia, manager: localMediaManager } = localMedia;
  const replaceTrackRef = useRef<ReturnType<typeof usePeerConnection>['replaceTrack'] | null>(null);

  // Микрофон — через шумоподавление, как в голосовых (#947); в соединение
  // уходит поток с обработанным звуком, камера — как есть.
  const { sendStream, audioConstraints } = useCallAudioPipeline({
    stream: localMedia.stream,
    isAudioMuted: localMedia.isAudioMuted,
    manager: localMediaManager,
    onAudioTrackChange: (track) => void replaceTrackRef.current?.('audio', track),
    env: audioEnvironment,
  });

  // Инициализация локального медиа при старте звонка
  useEffect(() => {
    if (localMedia.stream) return;
    void startMedia({
      audio: audioConstraints,
      video: activeCall.kind === 'video',
    });
    // При размонтировании stopMedia вызовется автоматически внутри useLocalMedia
  }, [activeCall.kind, startMedia, localMedia.stream, audioConstraints]);

  // Callee — polite (true), Caller — impolite (false)
  const isPolite = !activeCall.isCaller;

  const defaultPeerConnection = usePeerConnection({
    socket,
    roomId: activeCall.roomId,
    peerId: activeCall.peerId ?? fsm.peerId ?? '',
    isPolite,
    localStream: sendStream,
    autoConnect: !customPeerConnection,
  });

  const peerConnection = customPeerConnection ?? defaultPeerConnection;

  const { replaceTrack, restartIce } = peerConnection;

  useEffect(() => {
    replaceTrackRef.current = replaceTrack;
  }, [replaceTrack]);

  // Воспроизведение звука собеседника через постоянный audio-элемент (живет всю сессию звонка)
  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = peerConnection.remoteStream;
    }
  }, [peerConnection.remoteStream]);

  // Сменилась камера — новый трек в WebRTC sender. Микрофон сюда не идёт:
  // при его смене обработка перецепляет источник, а отправляемый трек тот же.
  useEffect(() => {
    return localMediaManager.onTrackReplaced((kind, _oldTrack, newTrack) => {
      if (kind === 'video') replaceTrack(kind, newTrack);
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
      void restartIce?.();
    } else if (connState === 'connected' && currentState === 'reconnecting') {
      useCallStore.getState().dispatch({ type: 'CONNECTION_RESTORED' });
    }
  }, [peerConnection.connectionState, restartIce]);

  // Отслеживаем, было ли соединение успешно установлено хотя бы один раз
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (peerConnection.connectionState === 'connected') {
      hasConnectedRef.current = true;
    }
  }, [peerConnection.connectionState]);

  // При возвращении собеседника в комнату или повторном входе пересоздаем WebRTC-соединение (#775)
  useEffect(() => {
    const unsubPeerJoined = eventBus.on(
      WS_EVENTS.CALL.PEER_JOINED,
      (payload: ICallPeerJoinedEvent) => {
        if (payload.roomId === activeCall.roomId) {
          const currentState = useCallStore.getState().fsm.state;
          if (currentState === 'reconnecting' || hasConnectedRef.current) {
            hasConnectedRef.current = false;
            if (currentState === 'active') {
              useCallStore.getState().dispatch({ type: 'CONNECTION_LOST' });
            }
            peerConnection.resetConnection?.();
          }
        }
      }
    );

    const unsubJoined = eventBus.on(WS_EVENTS.CALL.JOINED, (payload: ICallJoinedEvent) => {
      if (payload.roomId === activeCall.roomId) {
        const currentState = useCallStore.getState().fsm.state;
        if (hasConnectedRef.current) {
          hasConnectedRef.current = false;
          if (currentState === 'active') {
            useCallStore.getState().dispatch({ type: 'CONNECTION_LOST' });
          }
          peerConnection.resetConnection?.();
        }
      }
    });

    return () => {
      unsubPeerJoined();
      unsubJoined();
    };
  }, [activeCall.roomId, peerConnection]);

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
          verificationEmojis={peerConnection.verificationEmojis}
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
