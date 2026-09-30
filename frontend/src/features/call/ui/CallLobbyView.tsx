import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/shared/ui';
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
    if (customLocalMedia) return;
    void startMedia({
      audio: true,
      video: kind === 'video',
    });
    void enumerateDevices();
  }, [kind, startMedia, enumerateDevices, customLocalMedia]);

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
        <div className="relative w-full aspect-video rounded-window overflow-hidden bg-ground border border-line-soft flex items-center justify-center shadow-inner">
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
              className="size-10 rounded-full flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand bg-sheet text-ink data-[muted=true]:bg-danger data-[muted=true]:text-white"
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
              className="size-10 rounded-full flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand bg-sheet text-ink data-[muted=true]:text-ink-2 data-[muted=true]:opacity-70"
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
            <div className="flex flex-col gap-1">
              <label htmlFor="lobby-mic-select" className="font-medium text-ink">
                {t('call.lobby.microphone', 'Микрофон')}
              </label>
              <select
                id="lobby-mic-select"
                aria-label={t('call.lobby.microphone', 'Микрофон')}
                value={selectedAudioDeviceId ?? ''}
                onChange={(e) => void switchMicrophone(e.target.value)}
                className="w-full bg-ground text-ink border border-line-soft rounded-field px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand cursor-pointer"
              >
                {audioInputs.map((d, idx) => (
                  <option key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `${t('call.lobby.microphone', 'Микрофон')} ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === 'video' && videoInputs.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="lobby-cam-select" className="font-medium text-ink">
                {t('call.lobby.video', 'Камера')}
              </label>
              <select
                id="lobby-cam-select"
                aria-label={t('call.lobby.video', 'Камера')}
                value={selectedVideoDeviceId ?? ''}
                onChange={(e) => void switchCamera(e.target.value)}
                className="w-full bg-ground text-ink border border-line-soft rounded-field px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand cursor-pointer"
              >
                {videoInputs.map((d, idx) => (
                  <option key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `${t('call.lobby.video', 'Камера')} ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Кнопки действий */}
        <div className="w-full flex items-center justify-end gap-3 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-field border border-line-soft text-ink font-medium hover:bg-ground active:scale-95 transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-brand"
          >
            {t('call.lobby.cancel', 'Отмена')}
          </button>
          <button
            type="button"
            onClick={onJoin}
            className="px-6 py-2.5 rounded-field bg-brand text-white font-medium hover:opacity-95 active:scale-95 transition-transform shadow-[var(--elev-2)] cursor-pointer focus-visible:outline-2 focus-visible:outline-brand"
          >
            {t('call.lobby.join', 'Присоединиться')}
          </button>
        </div>
      </div>
    </div>
  );
}
