import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/shared/ui';
import type { IActiveCall, IMediaError, TCallConnectionState, TFacingMode } from '../model/types';
import { useCallDuration } from './useCallDuration';

export interface IActiveCallViewProps {
  activeCall: IActiveCall;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: TCallConnectionState;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  facingMode?: TFacingMode;
  availableCamerasCount?: number;
  mediaError?: IMediaError | null;
  callStartedAt: number | null;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onSwitchCamera?: () => void;
  onMinimize: () => void;
  onEndCall: () => void;
}

export function ActiveCallView({
  activeCall,
  localStream,
  remoteStream,
  connectionState,
  isAudioEnabled,
  isVideoEnabled,
  facingMode = 'user',
  availableCamerasCount = 0,
  mediaError,
  callStartedAt,
  onToggleAudio,
  onToggleVideo,
  onSwitchCamera,
  onMinimize,
  onEndCall,
}: IActiveCallViewProps) {
  const { t } = useTranslation();
  const duration = useCallDuration(callStartedAt);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [, setTrackUpdate] = useState(0);

  // Привязка локального видео
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = isVideoEnabled ? localStream : null;
    }
  }, [localStream, isVideoEnabled]);

  // Привязка удаленного видео и отслеживание активности видео- и аудио-треков
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream ?? null;
    }

    if (!remoteStream) {
      return;
    }

    const onTrackChange = () => {
      setTrackUpdate((v) => v + 1);
    };

    const tracks = [...remoteStream.getVideoTracks(), ...remoteStream.getAudioTracks()];
    tracks.forEach((track) => {
      track.addEventListener('mute', onTrackChange);
      track.addEventListener('unmute', onTrackChange);
      track.addEventListener('ended', onTrackChange);
    });

    return () => {
      tracks.forEach((track) => {
        track.removeEventListener('mute', onTrackChange);
        track.removeEventListener('unmute', onTrackChange);
        track.removeEventListener('ended', onTrackChange);
      });
    };
  }, [remoteStream]);

  const remoteVideoActive = Boolean(
    remoteStream &&
      remoteStream
        .getVideoTracks()
        .some((t) => t.enabled && !t.muted && t.readyState === 'live')
  );

  const remoteAudioMuted = Boolean(
    remoteStream &&
      remoteStream.getAudioTracks().length > 0 &&
      remoteStream.getAudioTracks().every((t) => t.muted || !t.enabled)
  );

  const getStatusText = () => {
    if (connectionState === 'connecting') {
      return t('call.status.connecting', 'Соединение…');
    }
    if (
      connectionState === 'reconnecting' ||
      connectionState === 'disconnected' ||
      connectionState === 'failed'
    ) {
      return t('call.status.reconnecting', 'Восстановление связи…');
    }
    return duration;
  };

  const getErrorMessage = () => {
    if (!mediaError) return null;
    switch (mediaError.name) {
      case 'NotAllowedError':
        return t('call.errors.notAllowed', 'Доступ к микрофону или камере запрещён');
      case 'NotFoundError':
        return t('call.errors.notFound', 'Устройство не найдено');
      case 'NotReadableError':
        return t('call.errors.notReadable', 'Устройство занято другим приложением');
      default:
        return t('call.errors.generic', 'Ошибка доступа к устройствам');
    }
  };

  const peerDisplayName =
    activeCall.peerName || activeCall.title || t('call.defaultUser', 'Пользователь');

  const isVideo = activeCall.kind === 'video';
  const showSwitchCamera = isVideo && isVideoEnabled && availableCamerasCount > 1 && onSwitchCamera;

  return (
    <div
      role="dialog"
      aria-label={t('call.activeDialog', 'Активный звонок')}
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex flex-col justify-between bg-ground select-none overflow-hidden"
    >
      {/* Шапка звонка */}
      <header className="relative z-30 flex items-center justify-between p-4 bg-gradient-to-b from-ground/80 to-transparent">
        <button
          type="button"
          onClick={onMinimize}
          className="size-10 rounded-full flex items-center justify-center text-ink bg-sheet/80 backdrop-blur-sm border border-line-soft shadow-[var(--elev-2)] hover:bg-sheet focus-visible:outline-2 focus-visible:outline-brand cursor-pointer"
          aria-label={t('call.minimize', 'Свернуть звонок')}
        >
          <Icon name="chevronDown" className="size-6" />
        </button>

        <div className="flex flex-col items-center text-center max-w-[60%]">
          <div className="flex items-center gap-1.5 max-w-full">
            <h2 className="text-base font-semibold text-ink truncate max-w-full">
              {peerDisplayName}
            </h2>
            {remoteAudioMuted && (
              <span
                className="text-danger flex items-center shrink-0"
                title={t('call.peerMicMuted', 'Собеседник выключил микрофон')}
                aria-label={t('call.peerMicMuted', 'Собеседник выключил микрофон')}
              >
                <Icon name="micOff" className="size-4" />
              </span>
            )}
          </div>
          <span
            aria-live="polite"
            className="text-xs font-medium text-ink-2"
          >
            {getStatusText()}
          </span>
        </div>

        <div className="size-10" aria-hidden="true" />
      </header>

      {/* Основная зона (Видео или Аудио) */}
      <main className="relative flex-1 flex items-center justify-center overflow-hidden">
        {isVideo ? (
          <div className="relative w-full h-full flex items-center justify-center bg-ground">
            {/* Удалённый видеопоток */}
            {remoteVideoActive ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                aria-label={t('call.remoteVideo', 'Видео собеседника')}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 text-center p-4">
                <Avatar
                  id={activeCall.peerId ?? 'peer'}
                  name={activeCall.peerName}
                  size="2xl"
                  src={activeCall.peerAvatar}
                />
                <p className="text-sm text-ink-2 font-medium">
                  {connectionState === 'connecting'
                    ? t('call.status.connecting', 'Соединение…')
                    : t('call.remoteVideoOff', 'Камера выключена')}
                </p>
              </div>
            )}

            {/* Локальное превью PiP */}
            {isVideoEnabled && localStream && (
              <div className="absolute top-4 right-4 z-20 w-28 h-40 sm:w-36 sm:h-52 rounded-window overflow-hidden border border-line-soft shadow-[var(--elev-2)] bg-sheet">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${facingMode !== 'environment' ? 'scale-x-[-1]' : ''}`}
                  aria-label={t('call.localVideo', 'Ваша камера')}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-6 p-6 text-center animate-fade-in">
            <div className="relative">
              <Avatar
                id={activeCall.peerId ?? 'peer'}
                name={activeCall.peerName}
                size="2xl"
                src={activeCall.peerAvatar}
                className="shadow-[var(--elev-2)]"
              />
              {connectionState === 'connected' && (
                <div className="absolute -inset-2 rounded-full border-2 border-brand/40 animate-ping pointer-events-none" />
              )}
            </div>
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-2 max-w-xs sm:max-w-md">
                <h1 className="text-xl sm:text-2xl font-bold text-ink truncate">
                  {peerDisplayName}
                </h1>
                {remoteAudioMuted && (
                  <span
                    className="size-7 rounded-full bg-danger/15 text-danger flex items-center justify-center shrink-0"
                    title={t('call.peerMicMuted', 'Собеседник выключил микрофон')}
                    aria-label={t('call.peerMicMuted', 'Собеседник выключил микрофон')}
                  >
                    <Icon name="micOff" className="size-4" />
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-ink-2">{getStatusText()}</p>
            </div>
          </div>
        )}

        {/* Баннер ошибки медиаустройств */}
        {mediaError && (
          <div
            role="alert"
            className="absolute top-4 left-4 right-4 z-30 flex items-center gap-3 p-3 bg-danger/15 border border-danger/30 rounded-window text-danger text-sm shadow-[var(--elev-2)] backdrop-blur-md"
          >
            <Icon name="warning" className="size-5 shrink-0" />
            <span className="flex-1">{getErrorMessage()}</span>
          </div>
        )}
      </main>

      {/* Панель управления звонком */}
      <footer className="relative z-30 p-6 flex flex-col items-center bg-gradient-to-t from-ground/90 via-ground/60 to-transparent">
        <div className="flex items-center justify-center gap-4 sm:gap-6 flex-wrap">
          {/* Микрофон */}
          <button
            type="button"
            onClick={onToggleAudio}
            data-muted={!isAudioEnabled}
            className="flex flex-col items-center gap-1.5 p-3 rounded-full cursor-pointer transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-brand bg-sheet text-ink border border-line-soft shadow-[var(--elev-2)] data-[muted=true]:bg-danger data-[muted=true]:text-white data-[muted=true]:border-transparent"
            aria-label={
              isAudioEnabled
                ? t('call.controls.muteMic', 'Выключить микрофон')
                : t('call.controls.unmuteMic', 'Включить микрофон')
            }
          >
            <Icon name={isAudioEnabled ? 'mic' : 'micOff'} className="size-6" />
          </button>

          {/* Камера */}
          <button
            type="button"
            onClick={onToggleVideo}
            data-muted={!isVideoEnabled}
            className="flex flex-col items-center gap-1.5 p-3 rounded-full cursor-pointer transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-brand bg-sheet text-ink border border-line-soft shadow-[var(--elev-2)] data-[muted=true]:text-ink-2 data-[muted=true]:opacity-70"
            aria-label={
              isVideoEnabled
                ? t('call.controls.stopVideo', 'Выключить камеру')
                : t('call.controls.startVideo', 'Включить камеру')
            }
          >
            <Icon name={isVideoEnabled ? 'video' : 'videoOff'} className="size-6" />
          </button>

          {/* Смена камеры */}
          {showSwitchCamera && (
            <button
              type="button"
              onClick={onSwitchCamera}
              className="flex flex-col items-center gap-1.5 p-3 rounded-full bg-sheet text-ink border border-line-soft shadow-[var(--elev-2)] cursor-pointer transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-brand"
              aria-label={t('call.controls.switchCamera', 'Переключить камеру')}
            >
              <Icon name="rotateCw" className="size-6" />
            </button>
          )}

          {/* Завершить звонок */}
          <button
            type="button"
            onClick={onEndCall}
            className="flex flex-col items-center gap-1.5 p-3.5 rounded-full bg-danger text-white shadow-[var(--elev-2)] cursor-pointer transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-danger"
            aria-label={t('call.controls.end', 'Завершить')}
          >
            <Icon name="phone" className="size-6 rotate-[135deg]" />
          </button>
        </div>
      </footer>
    </div>
  );
}
