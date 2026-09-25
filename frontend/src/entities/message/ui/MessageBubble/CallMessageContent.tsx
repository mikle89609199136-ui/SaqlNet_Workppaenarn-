import { Icon } from '@/shared/ui';
import type { IMessageDto } from '@/types';
import { formatCallDuration, parseCallContent } from '@/shared/lib';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
}

export const CallMessageContent = ({ message }: Props) => {
  const { t } = useTranslation();
  const duration = formatCallDuration(parseCallContent(message.content).duration);
  return (
    <div className="message-call-content flex items-center gap-3 min-w-[190px]">
      <div
        className="message-call-icon flex size-[42px] shrink-0 items-center justify-center rounded-full bg-line text-ink"
        aria-hidden="true"
      >
        <Icon name="phone" />
      </div>
      <div className="message-call-copy min-w-0 flex flex-col gap-0.5">
        <strong className="text-[16px] font-extrabold leading-tight text-ink">
          {t('callEnded', 'Звонок завершен')}
        </strong>
        {duration ? <span className="text-[13px] font-semibold text-ink-2">{duration}</span> : null}
      </div>
    </div>
  );
};
