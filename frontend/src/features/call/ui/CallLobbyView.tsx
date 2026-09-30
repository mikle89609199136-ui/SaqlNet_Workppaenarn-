import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Icon, Select } from '@/shared/ui';
import { useLocalMedia } from '../model/useLocalMedia';
import type { TCallKind } from '../model/types';

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
    }
  }, [stream, isVideoMuted]);

  const isAudioEnabled = !isAudioMuted;
  const isVideoEnabled = !isVideoMuted;

  return (
    <div
      role="dialog"
      aria-label={t('call.lobby.title', 'Лобби звонка')}
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-ground/85 backdrop-blur-md p-4 animate-fade-in select-none"
    >
      <div className="bg-sheet rounded-window shadow-[var(--elev-2)] border border-line-soft w-full max-w-lg p-6 flex flex-col items-center gap-5">
        {/* Заголовок */}
        <div className="text-center">
          <h2 className="text-lg sm:text-xl font-bold text-ink">
            {title || t('call.lobby.readyToJoin', 'Готовы присоединиться?')}
          </h2>
          <p className="text-sm text-ink-2 mt-1">
            {peerName
              ? `${peerName} — ${t('call.lobby.checkDevices', 'Проверьте камеру и микрофон перед входом')}`
              : t('call.lobby.checkDevices', 'Проверьте камеру и микрофон перед входом')}
          </p>
        </div>

        {/* Превью камеры */}
        <div className="relative w-full aspect-video rounded-window overflow-hidden bg-ground border border-line-soft flex items-center justify-center">
          {isVideoEnabled && stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${facingMode !== 'environment' ? 'scale-x-[-1]' : ''}`}
              aria-label={t('call.localVideo', 'Ваша камера')}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
              {peerAvatar ? (
                <Avatar id="preview" name={peerName ?? undefined} size="xl" src={peerAvatar} />
              ) : (
                <div className="size-16 rounded-full bg-sheet flex items-center justify-center text-ink-2 border border-line-soft">
                  <Icon name="videoOff" className="size-8" />
                </div>
              )}
              <span className="text-xs font-medium text-ink-2">
                {t('call.cameraOff', 'Камера выключена')}
              </span>
            </div>
          )}

          {/* Быстрые переключатели поверх видео */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-ground/70 backdrop-blur-md p-1.5 rounded-full border border-line-soft shadow-[var(--elev-2)]">
            <button
              type="button"
              onClick={() => toggleAudio()}
              data-muted={!isAudioEnabled}
              className="size-10 rounded-full flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand bg-sheet text-ink border border-line-soft shadow-[var(--elev-2)] data-[muted=true]:bg-danger data-[muted=true]:text-on-brand data-[muted=true]:border-danger"
              aria-label={
                isAudioEnabled
                  ? t('call.controls.muteMic', 'Выключить микрофон')
                  : t('call.controls.unmuteMic', 'Включить микрофон')
              }
            >
              <Icon name={isAudioEnabled ? 'mic' : 'micOff'} className="size-5" />
            </button>

            <button
              type="button"
              onClick={() => toggleVideo()}
              data-muted={!isVideoEnabled}
              className="size-10 rounded-full flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand bg-sheet text-ink border border-line-soft shadow-[var(--elev-2)] data-[muted=true]:text-ink-2 data-[muted=true]:opacity-70"
              aria-label={
                isVideoEnabled
                  ? t('call.controls.stopVideo', 'Выключить камеру')
                  : t('call.controls.startVideo', 'Включить камеру')
              }
            >
              <Icon name={isVideoEnabled ? 'video' : 'videoOff'} className="size-5" />
            </button>
          </div>
        </div>

        {/* Выбор устройств */}
        <div className="w-full flex flex-col gap-3 text-xs text-ink-2">
          {audioInputs.length > 0 && (
            <Select
              id="lobby-mic-select"
              label={t('call.lobby.microphone', 'Микрофон')}
              menuClassName="z-[10000]"
              options={audioInputs.map((d, idx) => ({
                value: d.deviceId,
                label: d.label || `${t('call.lobby.microphone', 'Микрофон')} ${idx + 1}`,
              }))}
              value={selectedAudioDeviceId}
              onChange={(val) => void switchMicrophone(val)}
            />
          )}

          {kind === 'video' && videoInputs.length > 0 && (
            <Select
              id="lobby-cam-select"
              label={t('call.lobby.video', 'Камера')}
              menuClassName="z-[10000]"
              options={videoInputs.map((d, idx) => ({
                value: d.deviceId,
                label: d.label || `${t('call.lobby.video', 'Камера')} ${idx + 1}`,
              }))}
              value={selectedVideoDeviceId}
              onChange={(val) => void switchCamera(val)}
            />
          )}
        </div>

        {/* Кнопки действий */}
        <div className="w-full flex items-center justify-end gap-3 mt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
          >
            {t('call.lobby.cancel', 'Отмена')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onJoin}
          >
            {t('call.lobby.join', 'Присоединиться')}
          </Button>
        </div>
      </div>
    </div>
  );
}
