import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/shared/ui';
import { CALLS_ENABLED } from '@/shared/config';
import { useCall } from '../model/useCall';
import { useLocalMedia } from '../model/useLocalMedia';
import { ActiveCallSession } from './ActiveCallSession';
import { CallLobbyView } from './CallLobbyView';

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
  } = useCall();

  const { stopMedia, stream } = localMedia;

  // Очистка медиа-потоков при завершении разговора и закрытии лобби
  useEffect(() => {
    if (!isInLobby && !activeCall && !incomingCall && !outgoingCall && stream) {
      stopMedia();
    }
  }, [isInLobby, activeCall, incomingCall, outgoingCall, stream, stopMedia]);

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
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-ground/80 backdrop-blur-md p-4 animate-fade-in">
        <div className="bg-sheet rounded-window shadow-[var(--elev-2)] p-6 w-full max-w-sm text-center flex flex-col items-center border border-line-soft">
          <Avatar
            className="mb-4"
            id={incomingCall.from}
            name={incomingCall.fromName}
            size="2xl"
            src={incomingCall.fromAvatar}
          />
          <h2 className="text-lg font-bold text-ink mb-1 truncate max-w-full">
            {incomingCall.fromName || t('call.unknownCaller', 'Неизвестный')}
          </h2>
          <p className="text-sm text-ink-2 mb-6">
            {incomingCall.kind === 'video'
              ? t('call.incomingVideo', 'Видеозвонок…')
              : t('call.incomingAudio', 'Аудиозвонок…')}
          </p>
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              className="flex flex-col items-center gap-2 group cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
              onClick={rejectCall}
              aria-label={t('call.reject', 'Отклонить')}
            >
              <div className="size-14 rounded-full bg-danger text-on-brand flex items-center justify-center shadow-[var(--elev-2)] transition-transform group-hover:scale-105 active:scale-95">
                <Icon name="phone" className="size-6 rotate-[135deg]" />
              </div>
              <span className="text-xs text-ink-2 font-medium">
                {t('call.reject', 'Отклонить')}
              </span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-2 group cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
              onClick={acceptCall}
              aria-label={t('call.accept', 'Принять')}
            >
              <div className="size-14 rounded-full bg-ok text-on-brand flex items-center justify-center shadow-[var(--elev-2)] transition-transform group-hover:scale-105 active:scale-95">
                <Icon name={incomingCall.kind === 'video' ? 'video' : 'phone'} className="size-6" />
              </div>
              <span className="text-xs text-ink-2 font-medium">{t('call.accept', 'Принять')}</span>
            </button>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-brand hover:underline mt-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-brand"
            onClick={() => setIsInLobby(true)}
            aria-label={t('call.lobby.configure', 'Настроить перед входом')}
          >
            <Icon name="video" className="size-3.5" />
            <span>{t('call.lobby.checkDevices', 'Проверить камеру и микрофон перед входом')}</span>
          </button>
        </div>
      </div>
    );
  }

  if (outgoingCall) {
    const getOutgoingSubtitle = () => {
      switch (outgoingCall.phase) {
        case 'calling':
          return t('call.status.calling', 'Вызов…');
        case 'ringing':
          return t('call.status.ringing', 'Звонит…');
        case 'declined':
          return t('call.status.declined', 'Отклонён');
        case 'busy':
          return t('call.status.busy', 'Занят');
        case 'no_answer':
          return t('call.status.noAnswer', 'Не отвечает');
        case 'cancelled':
          return t('call.status.cancelled', 'Вызов отменён');
        case 'failed':
          return t('call.status.failed', 'Сбой вызова');
        default:
          return t('call.status.calling', 'Вызов…');
      }
    };

    const isEnding = ['declined', 'busy', 'no_answer', 'cancelled', 'failed'].includes(
      outgoingCall.phase
    );

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-ground/80 backdrop-blur-md p-4 animate-fade-in">
        <div className="bg-sheet rounded-window shadow-[var(--elev-2)] p-6 w-full max-w-sm text-center flex flex-col items-center border border-line-soft">
          <Avatar
            className="mb-4"
            id={outgoingCall.peerId}
            name={outgoingCall.peerName ?? undefined}
            size="2xl"
            src={outgoingCall.peerAvatar}
          />
          <h2 className="text-lg font-bold text-ink mb-1 truncate max-w-full">
            {outgoingCall.peerName || outgoingCall.title || t('call.defaultUser', 'Пользователь')}
          </h2>
          <p className="text-sm text-ink-2 mb-6">{getOutgoingSubtitle()}</p>
          <div className="flex items-center justify-center">
            <button
              type="button"
              className="flex flex-col items-center gap-2 group cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
              onClick={cancelCall}
              disabled={isEnding}
              aria-label={t('call.cancel', 'Отменить')}
            >
              <div className="size-14 rounded-full bg-danger text-on-brand flex items-center justify-center shadow-[var(--elev-2)] transition-transform group-hover:scale-105 active:scale-95 group-disabled:opacity-50">
                <Icon name="phone" className="size-6 rotate-[135deg]" />
              </div>
              <span className="text-xs text-ink-2 font-medium">{t('call.cancel', 'Отменить')}</span>
            </button>
          </div>
        </div>
      </div>
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
    const getEndedSubtitle = () => {
      switch (endedCall.reason) {
        case 'peer_ended':
          return t('call.ended.peerEnded', 'Собеседник завершил звонок');
        case 'network_error':
          return t('call.ended.networkError', 'Связь прервана');
        case 'media_denied':
          return t('call.ended.mediaDenied', 'Нет доступа к микрофону или камере');
        case 'completed':
        default:
          return t('call.ended.completed', 'Звонок завершён');
      }
    };

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-ground/80 backdrop-blur-md p-4 animate-fade-in select-none">
        <div className="bg-sheet rounded-window shadow-[var(--elev-2)] p-6 w-full max-w-sm text-center flex flex-col items-center border border-line-soft">
          <Avatar
            className="mb-4"
            id={endedCall.peerId ?? 'peer'}
            name={endedCall.peerName ?? undefined}
            size="2xl"
            src={endedCall.peerAvatar}
          />
          <h2 className="text-lg font-bold text-ink mb-1 truncate max-w-full">
            {endedCall.peerName || t('call.defaultUser', 'Пользователь')}
          </h2>
          <p className="text-sm text-ink-2">{getEndedSubtitle()}</p>
        </div>
      </div>
    );
  }

  return null;
}
