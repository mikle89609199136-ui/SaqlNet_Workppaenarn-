import { useTranslation } from 'react-i18next';
import { chatRowStyles } from '@/entities/chat';
import type { ICallHistoryItemDto } from '@/services/types/callApi.types';
import { cn, formatChatListTime } from '@/shared/lib';
import { Avatar, buttonStyles, Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import { useCallStore } from '../../model/callStore';
import { formatCallDurationSeconds } from '../useCallDuration';

export interface ICallHistoryItemProps {
  item: ICallHistoryItemDto;
  onOpenChat: (chatId: string) => void;
  onRepeatCall?: (item: ICallHistoryItemDto) => void;
}

export function CallHistoryItem({ item, onOpenChat, onRepeatCall }: ICallHistoryItemProps) {
  const { t, i18n } = useTranslation();
  const initiateCall = useCallStore((s) => s.initiateCall);
  const isCallInProgress = useCallStore((s) =>
    Boolean(s.activeCall || s.outgoingCall || s.incomingCall)
  );

  const canOpenChat = Boolean(item.chatId);
  const peerName = item.peerName || t('call.history.unknown', 'Собеседник');

  let statusIcon: TIconTypes;
  let statusIconColor: string;
  let statusLabel: string;
  let statusLabelColor: string = 'text-ink-2';

  if (item.status === 'missed') {
    statusIcon = 'phoneMissed';
    statusIconColor = 'text-danger';
    statusLabel = t('call.history.missed', 'Пропущенный');
    statusLabelColor = 'text-danger';
  } else if (item.status === 'cancelled') {
    statusIcon = 'phoneOff';
    statusIconColor = 'text-ink-3';
    statusLabel = t('call.history.cancelled', 'Отменённый');
    statusLabelColor = 'text-ink-3';
  } else if (item.status === 'rejected') {
    statusIcon = 'phoneOff';
    statusIconColor = 'text-ink-3';
    statusLabel = t('call.history.rejected', 'Отклонённый');
    statusLabelColor = 'text-ink-3';
  } else if (item.direction === 'incoming') {
    statusIcon = 'phoneIncoming';
    statusIconColor = 'text-brand';
    statusLabel = t('call.history.incoming', 'Входящий');
  } else {
    statusIcon = 'phoneOutgoing';
    statusIconColor = 'text-ink-3';
    statusLabel = t('call.history.outgoing', 'Исходящий');
  }

  const hasDuration =
    item.status === 'answered' &&
    typeof item.durationSeconds === 'number' &&
    item.durationSeconds > 0;
  const formattedDuration = hasDuration ? formatCallDurationSeconds(item.durationSeconds!) : null;
  const timeFormatted = formatChatListTime(item.startedAt, i18n.language);

  const handleRowClick = () => {
    if (item.chatId) {
      onOpenChat(item.chatId);
    }
  };

  const handleRepeatCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCallInProgress || !item.chatId) return;

    if (onRepeatCall) {
      onRepeatCall(item);
      return;
    }

    void initiateCall(
      item.chatId,
      'private',
      peerName,
      item.kind,
      item.peerId,
      item.peerAvatar,
      peerName
    );
  };

  const callActionLabel =
    item.kind === 'video'
      ? t('call.history.videoCall', 'Видеозвонок')
      : t('call.history.audioCall', 'Аудиозвонок');

  return (
    <div className={cn(chatRowStyles, 'select-none')} data-testid="call-history-item">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none disabled:cursor-default"
        disabled={!canOpenChat}
        onClick={handleRowClick}
        type="button"
      >
        <Avatar id={item.peerId} name={peerName} size="lg" src={item.peerAvatar} />

        <div className="flex min-w-0 flex-1 flex-col gap-0.75">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-body font-semibold text-ink">{peerName}</span>
            {timeFormatted && (
              <time
                className="shrink-0 text-meta text-ink-3 tabular-nums"
                dateTime={item.startedAt}
              >
                {timeFormatted}
              </time>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-ui">
            <span aria-hidden="true" className={cn('flex shrink-0 items-center', statusIconColor)}>
              <Icon name={statusIcon} size="xs" />
            </span>
            <span className={cn('truncate', statusLabelColor)}>{statusLabel}</span>

            {item.kind === 'video' && (
              <span
                aria-label={t('call.history.videoCall', 'Видеозвонок')}
                className="flex shrink-0 items-center text-ink-3"
                role="img"
              >
                <Icon name="video" size="xs" />
              </span>
            )}

            {formattedDuration && (
              <>
                <span aria-hidden="true" className="text-ink-3">
                  ·
                </span>
                <span className="shrink-0 text-meta text-ink-3 tabular-nums">
                  {formattedDuration}
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      <button
        aria-label={callActionLabel}
        className={buttonStyles({
          variant: 'ghost',
          iconOnly: true,
          size: 'sm',
          shape: 'round',
          className: 'shrink-0 text-ink-2 hover:text-brand disabled:opacity-40',
        })}
        disabled={isCallInProgress || !item.chatId}
        onClick={handleRepeatCall}
        title={callActionLabel}
        type="button"
      >
        <Icon name={item.kind === 'video' ? 'video' : 'phone'} size="md" />
      </button>
    </div>
  );
}
