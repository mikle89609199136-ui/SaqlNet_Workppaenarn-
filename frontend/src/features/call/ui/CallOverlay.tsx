import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CALLS_ENABLED } from '@/shared/config';
import { useCall } from '../model/useCall';
import { useLocalMedia } from '../model/useLocalMedia';
import { ActiveCallSession } from './ActiveCallSession';
import { CallLobbyView } from './CallLobbyView';
import { CallStatusView } from './CallStatusView';
import { IncomingCallView } from './IncomingCallView';
import { ResumeCallBar } from './ResumeCallBar';

const ENDING_PHASES: string[] = ['declined', 'busy', 'no_answer', 'cancelled', 'failed'];

export interface ICallOverlayProps {
  enabled?: boolean;
  localMedia?: ReturnType<typeof useLocalMedia>;
}

/**
 * Оверлей входящего, исходящего и активного вызова поверх приложения (#773, #774).
 */
export function CallOverlay({
  enabled = CALLS_ENABLED,
  localMedia: customLocalMedia,
}: ICallOverlayProps) {
  const { t } = useTranslation();
  const [isInLobby, setIsInLobby] = useState(false);
  const defaultLocalMedia = useLocalMedia();
  const localMedia = customLocalMedia ?? defaultLocalMedia;

  const {
    incomingCall,
    outgoingCall,
    activeCall,
    endedCall,
    isMinimized,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    resumableCall,
    resumeCall,
    dismissResumableCall,
  } = useCall();

  const { stopMedia, stream } = localMedia;

  // Очистка медиа-потоков при завершении разговора и закрытии лобби
  useEffect(() => {
    if (!isInLobby && !activeCall && !incomingCall && !outgoingCall && stream) {
      stopMedia();
    }
  }, [isInLobby, activeCall, incomingCall, outgoingCall, stream, stopMedia]);

  // Сброс лобби, если входящий вызов отменён или завершён
  useEffect(() => {
    if (!incomingCall && isInLobby) {
      setIsInLobby(false);
    }
  }, [incomingCall, isInLobby]);

  useEffect(() => {
    if (enabled) return;
    if (incomingCall) rejectCall();
    else if (outgoingCall) cancelCall();
    else if (activeCall) endCall('completed');
  }, [enabled, incomingCall, outgoingCall, activeCall, rejectCall, cancelCall, endCall]);

  if (!enabled) return null;

  if (isInLobby && incomingCall) {
    return (
      <CallLobbyView
        title={incomingCall.title || undefined}
        peerName={incomingCall.fromName}
        peerAvatar={incomingCall.fromAvatar}
        kind={incomingCall.kind}
        localMedia={localMedia}
        onJoin={() => {
          setIsInLobby(false);
          acceptCall();
        }}
        onCancel={() => {
          setIsInLobby(false);
          localMedia.stopMedia();
          rejectCall();
        }}
      />
    );
  }

  if (incomingCall) {
    return (
      <IncomingCallView
        call={incomingCall}
        onAccept={() => acceptCall()}
        onAcceptWithoutVideo={() => acceptCall({ video: false })}
        onConfigure={() => setIsInLobby(true)}
        onReject={rejectCall}
      />
    );
  }

  if (outgoingCall) {
    const outgoingStatus: Record<string, string> = {
      calling:
        outgoingCall.kind === 'video'
          ? t('call.status.videoCalling', 'Видеовызов…')
          : t('call.status.calling', 'Вызов…'),
      ringing: t('call.status.ringing', 'Звонит…'),
      declined: t('call.status.declined', 'Отклонён'),
      busy: t('call.status.busy', 'Занят'),
      no_answer: t('call.status.noAnswer', 'Не отвечает'),
      cancelled: t('call.status.cancelled', 'Вызов отменён'),
      failed: t('call.status.failed', 'Сбой вызова'),
    };
    const isEnding = ENDING_PHASES.includes(outgoingCall.phase);

    return (
      <CallStatusView
        cancelDisabled={isEnding}
        onCancel={cancelCall}
        peerAvatar={outgoingCall.peerAvatar}
        peerId={outgoingCall.peerId}
        peerName={
          outgoingCall.peerName || outgoingCall.title || t('call.defaultUser', 'Пользователь')
        }
        ringing={!isEnding}
        status={outgoingStatus[outgoingCall.phase] ?? outgoingStatus.calling}
      />
    );
  }

  if (activeCall) {
    return (
      <ActiveCallSession
        activeCall={activeCall}
        isMinimized={isMinimized}
        localMedia={localMedia}
      />
    );
  }

  if (endedCall) {
    const endedStatus: Record<string, string> = {
      peer_ended: t('call.ended.peerEnded', 'Собеседник завершил звонок'),
      network_error: t('call.ended.networkError', 'Связь прервана'),
      media_denied: t('call.ended.mediaDenied', 'Нет доступа к микрофону или камере'),
    };

    return (
      <CallStatusView
        peerAvatar={endedCall.peerAvatar}
        peerId={endedCall.peerId}
        peerName={endedCall.peerName || t('call.defaultUser', 'Пользователь')}
        status={endedStatus[endedCall.reason] ?? t('call.ended.completed', 'Звонок завершён')}
      />
    );
  }

  if (resumableCall) {
    return (
      <ResumeCallBar call={resumableCall} onDismiss={dismissResumableCall} onResume={resumeCall} />
    );
  }

  return null;
}
