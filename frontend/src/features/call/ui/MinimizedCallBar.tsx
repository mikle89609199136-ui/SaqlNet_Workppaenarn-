import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';
import { cn } from '@/shared/lib';
import type { IActiveCall, TCallConnectionState } from '../model/types';
import { CallLayer } from './CallLayer';
import { useCallDuration } from './useCallDuration';

export interface IMinimizedCallBarProps {
  activeCall: IActiveCall;
  connectionState: TCallConnectionState;
  callStartedAt: number | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  onMaximize: () => void;
  onToggleAudio: () => void;
  onEndCall: () => void;
}

const ROUND =
  'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-pill transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-brand';

export function MinimizedCallBar({
  activeCall,
  connectionState,
  callStartedAt,
  isAudioEnabled,
  isVideoEnabled,
  onMaximize,
  onToggleAudio,
  onEndCall,
}: IMinimizedCallBarProps) {
  const { t } = useTranslation();
  const duration = useCallDuration(callStartedAt);
  const peerDisplayName =
    activeCall.peerName || activeCall.title || t('call.defaultUser', 'Пользователь');

  const status =
    connectionState === 'connecting'
      ? t('call.status.connecting', 'Соединение…')
      : ['reconnecting', 'disconnected', 'failed'].includes(connectionState)
        ? t('call.status.reconnecting', 'Восстановление…')
        : duration;

  return (
    <CallLayer
      aria-label={t('call.minimized.bar', 'Свёрнутый звонок')}
      className="flex items-center gap-2 bg-brand-fill pr-1.5 pl-3 text-on-brand select-none"
      role="region"
      screenClassName="fixed inset-x-0 top-0 z-[9990] h-[calc(44px+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]"
      stageClassName="absolute inset-x-0 top-16 z-30 h-11"
    >
      <button
        aria-label={t('call.minimized.maximize', 'Развернуть звонок')}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-on-brand"
        onClick={onMaximize}
        type="button"
      >
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-pill bg-on-brand animate-[rec-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
        />
        <span className="truncate text-[14px] font-semibold">{peerDisplayName}</span>
        <span aria-live="polite" className="shrink-0 text-[14px] text-on-brand/85 tabular-nums">
          {status}
        </span>
        {activeCall.kind === 'video' && !isVideoEnabled && (
          <Icon
            aria-label={t('call.cameraOff', 'Камера выключена')}
            className="size-3.5 shrink-0 text-on-brand/85"
            name="videoOff"
          />
        )}
        <span className="ml-auto shrink-0 pr-1 text-[13px] text-on-brand/85">
          {t('call.minimized.return', 'Вернуться')}
        </span>
      </button>

      <button
        aria-label={
          isAudioEnabled
            ? t('call.controls.muteMic', 'Выключить микрофон')
            : t('call.controls.unmuteMic', 'Включить микрофон')
        }
        aria-pressed={!isAudioEnabled}
        className={cn(
          ROUND,
          isAudioEnabled ? 'bg-on-brand/18 text-on-brand' : 'bg-on-brand text-brand-fill'
        )}
        onClick={onToggleAudio}
        type="button"
      >
        <Icon
          aria-label={isAudioEnabled ? undefined : t('call.controls.micMuted', 'Микрофон выключен')}
          className="size-4"
          name={isAudioEnabled ? 'mic' : 'micOff'}
        />
      </button>

      <button
        aria-label={t('call.controls.end', 'Завершить')}
        className={cn(ROUND, 'bg-call-reject text-on-brand')}
        onClick={onEndCall}
        type="button"
      >
        <Icon className="size-4 rotate-[135deg]" name="phone" />
      </button>
    </CallLayer>
  );
}
