import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Icon, NotoEmoji } from '@/shared/ui';
import { cn } from '@/shared/lib';
import type { IActiveCall, IMediaError, TCallConnectionState, TFacingMode } from '../model/types';
import { CallButton } from './CallButton';
import { CallSurface } from './CallSurface';
import { RingingAvatar } from './RingingAvatar';
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
  verificationEmojis?: string[] | null;
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
  verificationEmojis,
  onToggleAudio,
  onToggleVideo,
  onSwitchCamera,
  onMinimize,
  onEndCall,
}: IActiveCallViewProps) {
  const { t } = useTranslation();
  const duration = useCallDuration(callStartedAt);
  const dialogRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const isCameraOn = isVideoEnabled && !!localStream?.getVideoTracks().length;
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [, setTrackUpdate] = useState(0);
  const currentVerificationKey =
    verificationEmojis && verificationEmojis.length === 4 ? verificationEmojis.join(' ') : null;
  const [openedVerificationKey, setOpenedVerificationKey] = useState<string | null>(null);
  const verificationButtonRef = useRef<HTMLButtonElement>(null);
  const verificationPopoverRef = useRef<HTMLDivElement>(null);

  const showVerification = Boolean(
    currentVerificationKey && openedVerificationKey === currentVerificationKey
  );

  const handleCloseVerification = () => {
    setOpenedVerificationKey(null);
    verificationButtonRef.current?.focus();
  };

  // Закрытие поповера по клику снаружи или Escape
  useEffect(() => {
    if (!showVerification) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        verificationPopoverRef.current &&
        !verificationPopoverRef.current.contains(target) &&
        !verificationButtonRef.current?.contains(target)
      ) {
        setOpenedVerificationKey(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenedVerificationKey(null);
        verificationButtonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showVerification]);

  const remoteVideoActive = Boolean(
    remoteStream &&
    remoteStream.getVideoTracks().some((t) => t.enabled && !t.muted && t.readyState === 'live')
  );

  const remoteAudioMuted = Boolean(
    remoteStream &&
    remoteStream.getAudioTracks().length > 0 &&
    remoteStream.getAudioTracks().every((t) => t.muted || !t.enabled)
  );

  // Удержание фокуса внутри диалога (WAI-ARIA modal)
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    const focusable = el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Привязка локального видео
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = isCameraOn ? localStream : null;
      if (isCameraOn) {
        localVideoRef.current.play()?.catch(() => {});
      }
    }
  }, [localStream, isCameraOn]);

  // Привязка удаленного видео при появлении потока и размучивании трека
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteVideoActive ? (remoteStream ?? null) : null;
      if (remoteVideoActive && remoteStream) {
        remoteVideoRef.current.play()?.catch(() => {});
      }
    }
  }, [remoteStream, remoteVideoActive]);

  // Отслеживание активности видео- и аудио-треков удаленного потока
  useEffect(() => {
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
  const showRemoteVideo = isVideo && remoteVideoActive;
  const showSwitchCamera = isVideo && isCameraOn && availableCamerasCount > 1 && onSwitchCamera;
  const glowSeed = showRemoteVideo ? undefined : activeCall.peerId || peerDisplayName;
  const peerMicMutedLabel = t('call.peerMicMuted', 'Собеседник выключил микрофон');

  return (
    <CallSurface
      aria-label={t('call.activeDialog', 'Активный звонок')}
      aria-modal="true"
      className="justify-between"
      glowSeed={glowSeed}
      ref={dialogRef}
      role="dialog"
    >
      {showRemoteVideo && (
        <>
          <video
            aria-label={t('call.remoteVideo', 'Видео собеседника')}
            autoPlay
            className="absolute inset-0 size-full object-cover"
            muted
            playsInline
            ref={remoteVideoRef}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-35 bg-gradient-to-b from-call-ground/80 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-50 bg-gradient-to-t from-call-ground/90 to-transparent" />
        </>
      )}

      <header className="relative z-10 flex items-start justify-between gap-3 p-4 pt-[calc(16px+env(safe-area-inset-top,0px))]">
        <div className="flex min-w-0 items-center gap-3">
          <button
            aria-label={t('call.minimize', 'Свернуть звонок')}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-pill bg-scrim-control text-on-scrim hover:bg-scrim-control-hover focus-visible:outline-2 focus-visible:outline-on-scrim"
            onClick={onMinimize}
            type="button"
          >
            <Icon className="size-4.5" name="minimize" />
          </button>
          {showRemoteVideo && (
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-[15px] font-semibold">{peerDisplayName}</h2>
              <span aria-live="polite" className="text-[12px] text-on-scrim/75 tabular-nums">
                {getStatusText()}
              </span>
            </div>
          )}
        </div>

        {currentVerificationKey && verificationEmojis && (
          <div className="relative">
            <button
              aria-expanded={showVerification}
              aria-haspopup="dialog"
              aria-label={t('call.verification.buttonLabel', 'Сверка ключа звонка')}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-pill bg-scrim-control px-2.5 text-on-scrim hover:bg-scrim-control-hover focus-visible:outline-2 focus-visible:outline-on-scrim"
              onClick={() =>
                setOpenedVerificationKey((prev) =>
                  prev === currentVerificationKey ? null : currentVerificationKey
                )
              }
              ref={verificationButtonRef}
              type="button"
            >
              <Icon className="size-3.5" name="lock" />
              {verificationEmojis.map((emoji, index) => (
                <NotoEmoji emoji={emoji} key={index} size={16} />
              ))}
            </button>

            {showVerification && (
              <div
                aria-label={t('call.verification.title', 'Сверка ключа звонка')}
                aria-modal="false"
                className="absolute top-10 right-0 z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-dialog bg-menu p-4 text-ink shadow-[var(--shadow-menu)]"
                ref={verificationPopoverRef}
                role="dialog"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-ui font-semibold">
                    <Icon className="size-4 text-brand" name="lock" />
                    <span>{t('call.verification.title', 'Сверка ключа звонка')}</span>
                  </div>
                  <button
                    aria-label={t('call.verification.close', 'Закрыть')}
                    className="flex size-7 cursor-pointer items-center justify-center rounded-pill text-ink-2 hover:layer-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={handleCloseVerification}
                    type="button"
                  >
                    <Icon className="size-3.5" name="cross" />
                  </button>
                </div>
                <div
                  aria-label={verificationEmojis.join(' ')}
                  className="flex items-center justify-center gap-2.5 rounded-field bg-sheet-2 py-2.5"
                  role="group"
                >
                  <span className="sr-only">{verificationEmojis.join(' ')}</span>
                  {verificationEmojis.map((emoji, index) => (
                    <NotoEmoji emoji={emoji} key={index} size={32} />
                  ))}
                </div>
                <p className="text-caption leading-relaxed text-ink-2">
                  {t(
                    'call.verification.hint',
                    'Сравните эти 4 эмодзи с собеседником. Если у собеседника такие же — вас никто не слушает.'
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        {!showRemoteVideo && (
          <>
            <RingingAvatar
              id={activeCall.peerId || peerDisplayName}
              name={activeCall.peerName}
              ringing={false}
              src={activeCall.peerAvatar}
            />
            <div className="flex flex-col items-center gap-1">
              <div className="flex max-w-full items-center gap-2">
                <h1 className="truncate text-[26px] leading-tight font-semibold">
                  {peerDisplayName}
                </h1>
                {remoteAudioMuted && (
                  <span
                    aria-label={peerMicMutedLabel}
                    className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-scrim-control"
                    role="img"
                    title={peerMicMutedLabel}
                  >
                    <Icon className="size-4" name="micOff" />
                  </span>
                )}
              </div>
              <p aria-live="polite" className="text-[15px] text-on-scrim/75 tabular-nums">
                {isVideo && connectionState === 'connected'
                  ? t('call.remoteVideoOff', 'Камера выключена')
                  : getStatusText()}
              </p>
            </div>
          </>
        )}

        {mediaError && (
          <div className="absolute inset-x-4 top-0">
            <Banner role="alert" tone="danger">
              {getErrorMessage()}
            </Banner>
          </div>
        )}
      </main>

      {isCameraOn && (
        <div className="absolute right-4 bottom-32 z-20 h-37.5 w-27 overflow-hidden rounded-[16px] bg-call-ground shadow-[0_8px_24px_rgba(0,0,0,0.4)] md:h-35 md:w-55">
          <video
            aria-label={t('call.localVideo', 'Ваша камера')}
            autoPlay
            className={cn('size-full object-cover', facingMode !== 'environment' && 'scale-x-[-1]')}
            muted
            playsInline
            ref={localVideoRef}
          />
          <span className="absolute bottom-2 left-2.5 text-[12px] font-semibold text-on-scrim">
            {t('call.you', 'Вы')}
          </span>
        </div>
      )}

      <footer className="relative z-10 flex flex-col items-center gap-3 px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))]">
        {!isAudioEnabled && (
          <div className="flex h-7.5 items-center gap-1.5 rounded-pill bg-scrim-subtle px-3 text-[13px]">
            <Icon className="size-3.5" name="micOff" />
            {t('call.micMutedNotice', 'Ваш микрофон выключен')}
          </div>
        )}
        <div className="flex items-start justify-center gap-5">
          <CallButton
            aria-label={
              isAudioEnabled
                ? t('call.controls.muteMic', 'Выключить микрофон')
                : t('call.controls.unmuteMic', 'Включить микрофон')
            }
            aria-pressed={!isAudioEnabled}
            caption={t('call.caption.mic', 'Микрофон')}
            icon={isAudioEnabled ? 'mic' : 'micOff'}
            onClick={onToggleAudio}
            tone={isAudioEnabled ? 'control' : 'active'}
          />
          {isVideo && (
            <CallButton
              aria-label={
                isCameraOn
                  ? t('call.controls.stopVideo', 'Выключить камеру')
                  : t('call.controls.startVideo', 'Включить камеру')
              }
              aria-pressed={isCameraOn}
              caption={t('call.caption.camera', 'Камера')}
              icon={isCameraOn ? 'video' : 'videoOff'}
              onClick={onToggleVideo}
              tone={isCameraOn ? 'active' : 'control'}
            />
          )}
          {showSwitchCamera && (
            <CallButton
              aria-label={t('call.controls.switchCamera', 'Переключить камеру')}
              caption={t('call.caption.flip', 'Перевернуть')}
              icon="rotateCw"
              onClick={onSwitchCamera}
            />
          )}
          <CallButton
            aria-label={t('call.controls.end', 'Завершить')}
            caption={t('call.controls.end', 'Завершить')}
            icon="phone"
            iconClassName="rotate-[135deg]"
            onClick={onEndCall}
            tone="reject"
          />
        </div>
      </footer>
    </CallSurface>
  );
}
