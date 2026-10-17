import { Icon } from '@/shared/ui';
import type { IMessageDto } from '@/types';
import { cn, describeCallMessage, formatCallDetail, formatCallTitle } from '@/shared/lib';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
  /** Кто смотрит: от него зависит, входящий звонок или исходящий. */
  currentUserId?: string;
  /** Время и статус — справа внизу, в одной строке со звонком. */
  trailing?: ReactNode;
}

/* Звонок в ленте — по макету (#820): кружок 36 с трубкой на мягкой
   подложке акцента, заголовок и вторая строка, время справа внизу.
   Тип и итог — как в истории звонков (#722, #1073): пропущенный красным. */
export const CallMessageContent = ({ message, currentUserId, trailing }: Props) => {
  const { t } = useTranslation();
  const info = describeCallMessage(message.content, message.senderId, currentUserId);
  const missed = info.direction === 'incoming' && !info.answered;
  const detail = formatCallDetail(info, t);

  return (
    <div
      className="message-call-content flex items-center gap-3"
      data-call={missed ? 'missed' : info.direction}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-brand group-data-[mine]/bubble:bg-on-brand/16 group-data-[mine]/bubble:text-on-brand',
          // Пропущенный всегда в чужом пузыре: звонивший — отправитель.
          missed && 'bg-danger-soft text-danger'
        )}
      >
        <Icon
          className="size-4.5"
          name={
            missed
              ? 'phoneMissed'
              : info.direction === 'incoming'
                ? 'phoneIncoming'
                : 'phoneOutgoing'
          }
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{formatCallTitle(info, t)}</span>
        {detail ? (
          <span className={cn('text-caption text-ink-2', 'group-data-[mine]/bubble:text-out-meta')}>
            {detail}
          </span>
        ) : null}
      </span>
      {trailing && <span className="-ml-0.5 self-end">{trailing}</span>}
    </div>
  );
};
