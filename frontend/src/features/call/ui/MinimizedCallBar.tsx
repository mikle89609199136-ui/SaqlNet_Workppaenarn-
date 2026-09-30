import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/shared/ui';
import type { IActiveCall, TCallConnectionState } from '../model/types';
import { useCallDuration } from './useCallDuration';

export interface IMinimizedCallBarProps {
  activeCall: IActiveCall;
  connectionState: TCallConnectionState;
  callStartedAt: number | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  onMaximize: () => void;
  onEndCall: () => void;
}

export function MinimizedCallBar({
  activeCall,
  connectionState,
  callStartedAt,
  isAudioEnabled,
  onMaximize,
  onEndCall,
}: IMinimizedCallBarProps) {
  const { t } = useTranslation();
  const duration = useCallDuration(callStartedAt);

  const peerDisplayName =
    activeCall.peerName || activeCall.title || t('call.defaultUser', 'Пользователь');

  const getStatusText = () => {
    if (connectionState === 'connecting') {
      return t('call.status.connecting', 'Соединение…');
    }
    if (
      connectionState === 'reconnecting' ||
      connectionState === 'disconnected' ||
      connectionState === 'failed'
    ) {
      return t('call.status.reconnecting', 'Восстановление…');
    }
    return duration;
  };

  return (
    <aside
      role="region"
      aria-label={t('call.minimized.bar', 'Свёрнутый звонок')}
      className="fixed z-[9990] top-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md bg-sheet/95 backdrop-blur-md border border-line-soft shadow-[var(--elev-2)] rounded-window px-4 py-2.5 flex items-center justify-between gap-3 animate-fade-in select-none"
    >
      {/* Информация о звонке (клик разворачивает) */}
      <button
        type="button"
        onClick={onMaximize}
        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-brand rounded-field"
        aria-label={t('call.minimized.maximize', 'Развернуть звонок')}
      >
        <Avatar
          id={activeCall.peerId ?? 'peer'}
          name={activeCall.peerName}
          size="sm"
          src={activeCall.peerAvatar}
        />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-ink truncate">
              {peerDisplayName}
            </span>
            {!isAudioEnabled && (
              <Icon
                name="micOff"
                className="size-3 text-danger shrink-0"
                aria-label={t('call.controls.micMuted', 'Микрофон выключен')}
              />
            )}
          </div>
          <span className="text-[11px] font-medium text-ink-2">
            {getStatusText()}
          </span>
        </div>
      </button>

      {/* Кнопки действий */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onMaximize}
          className="size-8 rounded-full flex items-center justify-center text-ink hover:bg-ground active:scale-95 transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-brand"
          aria-label={t('call.minimized.maximize', 'Развернуть звонок')}
        >
          <Icon name="maximize" className="size-4" />
        </button>

        <button
          type="button"
          onClick={onEndCall}
          className="size-8 rounded-full bg-danger text-white flex items-center justify-center hover:opacity-90 active:scale-95 transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-danger"
          aria-label={t('call.controls.end', 'Завершить')}
        >
          <Icon name="phone" className="size-4 rotate-[135deg]" />
        </button>
      </div>
    </aside>
  );
}
