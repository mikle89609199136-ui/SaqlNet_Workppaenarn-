import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Icon, Select } from '@/shared/ui';
import { cn } from '@/shared/lib';
import { useLocalMedia } from '../model/useLocalMedia';
import type { TCallKind } from '../model/types';
import { CallButton } from './CallButton';

export interface ICallLobbyViewProps {
  title?: string;
  peerName?: string | null;
  peerAvatar?: string | null;
  kind?: TCallKind;
  localMedia?: ReturnType<typeof useLocalMedia>;
  onJoin: () => void;
  onCancel: () => void;
}

export function CallLobbyView({
  title,
  peerName,
  peerAvatar,
  kind = 'video',
  localMedia: customLocalMedia,
  onJoin,
  onCancel,
}: ICallLobbyViewProps) {
  const { t } = useTranslation();
  const defaultLocalMedia = useLocalMedia();
  const localMedia = customLocalMedia ?? defaultLocalMedia;
  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    stream,
    isAudioMuted,
    isVideoMuted,
    facingMode,
    audioInputs,
    videoInputs,
    selectedAudioDeviceId,
    selectedVideoDeviceId,
    startMedia,
    toggleAudio,
    toggleVideo,
    switchMicrophone,
    switchCamera,
    enumerateDevices,
  } = localMedia;

  useEffect(() => {
    void startMedia({
      audio: true,
      video: kind === 'video',
    });
    void enumerateDevices();
  }, [kind, startMedia, enumerateDevices]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = !isVideoMuted ? stream : null;
      if (!isVideoMuted && stream) {
        videoRef.current.play()?.catch(() => {});
      }
    }
  }, [stream, isVideoMuted]);

  const isAudioEnabled = !isAudioMuted;
  const isVideoEnabled = !isVideoMuted;

  return (
    <div
      aria-label={t('call.lobby.title', 'Лобби звонка')}
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-backdrop p-4 select-none animate-fade-in"
      role="dialog"
    >
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-dialog bg-menu p-5 shadow-[var(--shadow-menu)]">
        <div className="flex flex-col gap-1 text-center">
          <h2 className="text-section font-semibold text-ink">
            {title || t('call.lobby.readyToJoin', 'Готовы присоединиться?')}
          </h2>
          <p className="text-ui text-ink-2">
            {peerName
              ? `${peerName} — ${t('call.lobby.checkDevices', 'Проверьте камеру и микрофон перед входом')}`
              : t('call.lobby.checkDevices', 'Проверьте камеру и микрофон перед входом')}
          </p>
        </div>

        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[16px] bg-call-ground text-on-scrim">
          {isVideoEnabled && stream ? (
            <video
              aria-label={t('call.localVideo', 'Ваша камера')}
              autoPlay
              className={cn(
                'size-full object-cover',
                facingMode !== 'environment' && 'scale-x-[-1]'
              )}
              muted
              playsInline
              ref={videoRef}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
              {peerAvatar ? (
                <Avatar id="preview" name={peerName ?? undefined} size="xl" src={peerAvatar} />
              ) : (
                <span className="flex size-16 items-center justify-center rounded-pill bg-scrim-control">
                  <Icon className="size-8" name="videoOff" />
                </span>
              )}
              <span className="text-caption text-on-scrim/75">
                {t('call.cameraOff', 'Камера выключена')}
              </span>
            </div>
          )}

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3">
            <CallButton
              aria-label={
                isAudioEnabled
                  ? t('call.controls.muteMic', 'Выключить микрофон')
                  : t('call.controls.unmuteMic', 'Включить микрофон')
              }
              aria-pressed={!isAudioEnabled}
              icon={isAudioEnabled ? 'mic' : 'micOff'}
              onClick={() => toggleAudio()}
              size="md"
              tone={isAudioEnabled ? 'control' : 'active'}
            />
            <CallButton
              aria-label={
                isVideoEnabled
                  ? t('call.controls.stopVideo', 'Выключить камеру')
                  : t('call.controls.startVideo', 'Включить камеру')
              }
              aria-pressed={isVideoEnabled}
              icon={isVideoEnabled ? 'video' : 'videoOff'}
              onClick={() => toggleVideo()}
              size="md"
              tone={isVideoEnabled ? 'active' : 'control'}
            />
          </div>
        </div>

        <div className="flex w-full flex-col gap-3">
          {audioInputs.length > 0 && (
            <Select
              id="lobby-mic-select"
              label={t('call.lobby.microphone', 'Микрофон')}
              menuClassName="z-[10000]"
              onChange={(val) => void switchMicrophone(val)}
              options={audioInputs.map((d, idx) => ({
                value: d.deviceId,
                label: d.label || `${t('call.lobby.microphone', 'Микрофон')} ${idx + 1}`,
              }))}
              value={selectedAudioDeviceId}
            />
          )}

          {kind === 'video' && videoInputs.length > 0 && (
            <Select
              id="lobby-cam-select"
              label={t('call.lobby.video', 'Камера')}
              menuClassName="z-[10000]"
              onChange={(val) => void switchCamera(val)}
              options={videoInputs.map((d, idx) => ({
                value: d.deviceId,
                label: d.label || `${t('call.lobby.video', 'Камера')} ${idx + 1}`,
              }))}
              value={selectedVideoDeviceId}
            />
          )}
        </div>

        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {t('call.lobby.cancel', 'Отмена')}
          </Button>
          <Button onClick={onJoin} type="button" variant="primary">
            {t('call.lobby.join', 'Присоединиться')}
          </Button>
        </div>
      </div>
    </div>
  );
}
