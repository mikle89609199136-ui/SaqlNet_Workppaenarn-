import { Icon } from '@/shared/ui';
import type { IMessageDto } from '@/types';
import { cn, formatCallDuration, parseCallContent } from '@/shared/lib';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
  /** Время и статус — справа внизу, в одной строке со звонком. */
  trailing?: ReactNode;
}

/* Звонок в ленте — по макету (#820): кружок 36 с трубкой на мягкой
   подложке акцента, заголовок и длительность, время справа внизу. */
export const CallMessageContent = ({ message, trailing }: Props) => {
  const { t } = useTranslation();
  const duration = formatCallDuration(parseCallContent(message.content).duration);
  return (
    <div className="message-call-content flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-brand group-data-[mine]/bubble:bg-on-brand/16 group-data-[mine]/bubble:text-on-brand"
      >
        <Icon className="size-4.5" name="phone" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{t('callEnded', 'Звонок завершен')}</span>
        {duration ? (
          <span className={cn('text-caption text-ink-2', 'group-data-[mine]/bubble:text-out-meta')}>
            {duration}
          </span>
        ) : null}
      </span>
      {trailing && <span className="-ml-0.5 self-end">{trailing}</span>}
    </div>
  );
};
