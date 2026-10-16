import { useIsMobile } from '@/shared/lib';
import { useTranslation } from 'react-i18next';
import type { IIncomingCall } from '../model/types';
import { CallButton } from './CallButton';
import { CallLayer } from './CallLayer';
import { CallSurface } from './CallSurface';
import { RingingAvatar } from './RingingAvatar';

interface Props {
  call: IIncomingCall;
  onAccept: () => void;
  onAcceptWithoutVideo: () => void;
  onReject: () => void;
  onConfigure: () => void;
}

const HANG_UP = 'rotate-[135deg]';

export function IncomingCallView({
  call,
  onAccept,
  onAcceptWithoutVideo,
  onReject,
  onConfigure,
}: Props) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isVideo = call.kind === 'video';
  const name = call.fromName || t('call.unknownCaller', 'Неизвестный');
  const kindLabel = isVideo
    ? t('call.incomingVideoCall', 'Входящий видеозвонок')
    : t('call.incomingAudioCall', 'Входящий звонок');
  const acceptWithoutVideoLabel = t('call.acceptWithoutVideo', 'Ответить без видео');

  const configure = (
    <button
      aria-label={t('call.lobby.configure', 'Настроить перед входом')}
      className="cursor-pointer text-caption text-on-scrim/70 underline-offset-3 hover:text-on-scrim hover:underline focus-visible:outline-2 focus-visible:outline-on-scrim"
      onClick={onConfigure}
      type="button"
    >
      {t('call.lobby.checkDevices', 'Проверить камеру и микрофон перед входом')}
    </button>
  );

  if (isMobile) {
    return (
      <CallSurface
        aria-label={kindLabel}
        className="items-center justify-between px-6 pt-[calc(96px+env(safe-area-inset-top,0px))] pb-[calc(48px+env(safe-area-inset-bottom,0px))] text-center"
        glowSeed={call.from || call.fromName || ''}
        role="alertdialog"
      >
        <div className="flex flex-col items-center gap-4">
          <RingingAvatar id={call.from} name={call.fromName} src={call.fromAvatar} />
          <div className="flex flex-col gap-1">
            <h2 className="text-[28px] leading-tight font-semibold">{name}</h2>
            <p className="text-[15px] text-on-scrim/75">{kindLabel}</p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-start justify-center gap-10">
            <CallButton
              aria-label={t('call.reject', 'Отклонить')}
              caption={t('call.reject', 'Отклонить')}
              icon="phone"
              iconClassName={HANG_UP}
              onClick={onReject}
              size="xl"
              tone="reject"
            />
            {isVideo && (
              <CallButton
                aria-label={acceptWithoutVideoLabel}
                caption={t('call.withoutVideo', 'Без видео')}
                icon="phone"
                onClick={onAcceptWithoutVideo}
                size="xl"
              />
            )}
            <CallButton
              aria-label={t('call.accept', 'Принять')}
              caption={t('call.accept', 'Принять')}
              icon={isVideo ? 'video' : 'phone'}
              onClick={onAccept}
              size="xl"
              tone="accept"
            />
          </div>
          {configure}
        </div>
      </CallSurface>
    );
  }

  return (
    <CallLayer
      aria-label={kindLabel}
      className="flex w-[404px] max-w-[calc(100%-24px)] flex-col gap-2 rounded-window bg-call-ground p-3 text-on-scrim shadow-[0_20px_50px_rgba(0,0,0,0.45)] animate-fade-in"
      role="alertdialog"
      screenClassName="fixed top-5 right-5 z-[9999]"
      stageClassName="absolute top-2.5 right-2.5 z-40"
    >
      <div className="flex items-center gap-3">
        <RingingAvatar id={call.from} name={call.fromName} size="md" src={call.fromAvatar} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-[16px] font-semibold">{name}</h2>
          <p className="truncate text-[13px] text-on-scrim/70">{kindLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isVideo && (
            <CallButton
              aria-label={acceptWithoutVideoLabel}
              icon="phone"
              onClick={onAcceptWithoutVideo}
              size="md"
              title={acceptWithoutVideoLabel}
            />
          )}
          <CallButton
            aria-label={t('call.reject', 'Отклонить')}
            icon="phone"
            iconClassName={HANG_UP}
            onClick={onReject}
            size="md"
            tone="reject"
          />
          <CallButton
            aria-label={t('call.accept', 'Принять')}
            icon={isVideo ? 'video' : 'phone'}
            onClick={onAccept}
            size="md"
            tone="accept"
          />
        </div>
      </div>
      <div className="pl-14">{configure}</div>
    </CallLayer>
  );
}
