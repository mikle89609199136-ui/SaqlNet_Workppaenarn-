import { Icon } from '@/components/ui';
import type { IMessageDto } from '@/types';
import { formatCallDuration, parseCallContent } from '@/utils';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
}

export const CallMessageContent = ({ message }: Props) => {
  const { t } = useTranslation();
  const duration = formatCallDuration(parseCallContent(message.content).duration);
  return (
    <div className="message-call-content">
      <div className="message-call-icon" aria-hidden="true">
        <Icon name="phone" />
      </div>
      <div className="message-call-copy">
        <strong>{t('callEnded', 'Звонок завершен')}</strong>
        {duration ? <span>{duration}</span> : null}
      </div>
    </div>
  );
};
