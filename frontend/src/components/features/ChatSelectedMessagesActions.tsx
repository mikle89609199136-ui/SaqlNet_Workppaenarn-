import { useIsMobile } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { ComposerRow, ComposerWrapper, Icon } from '../ui';

interface Props {
  handleCancelSelection: () => void;
  onForwardMessage: () => void;
  onCopyMessage: () => void;
  onDeleteMessage: () => void;
}

export const ChatSelectedMessagesActions = ({
  handleCancelSelection,
  onCopyMessage,
  onDeleteMessage,
  onForwardMessage,
}: Props) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  return (
    <ComposerWrapper>
      <ComposerRow className="justify-between">
        <div className="flex items-center gap-x-2">
          <button
            type="button"
            onClick={onForwardMessage}
            className="flex items-center gap-x-1 w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
          >
            <Icon name="forward" />
            {!isMobile && <span>{t('forward', 'Переслать')}</span>}
          </button>
          <button
            type="button"
            onClick={onCopyMessage}
            className="flex items-center gap-x-1 w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
          >
            <Icon name="copy" />
            {!isMobile && <span>{t('copy', 'Скопировать')}</span>}
          </button>
          <button
            type="button"
            onClick={onDeleteMessage}
            className="flex items-center gap-x-1 w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
          >
            <Icon name="trash" />
            {!isMobile && <span>{t('delete', 'Удалить')}</span>}
          </button>
        </div>
        <button
          type="button"
          onClick={handleCancelSelection}
          className="w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
        >
          <span>{t('cancel', 'Отмена')}</span>
        </button>
      </ComposerRow>
    </ComposerWrapper>
  );
};
