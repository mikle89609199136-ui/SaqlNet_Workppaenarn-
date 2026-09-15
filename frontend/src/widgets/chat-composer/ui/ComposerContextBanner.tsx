import { Icon } from '@/shared/ui';
import { useChatUiStore } from '@/store';
import { getMessagePreview } from '@/entities/message';
import { useTranslation } from 'react-i18next';

interface Props {
  onCancel: () => void;
}

export const ComposerContextBanner = ({ onCancel }: Props) => {
  const { t } = useTranslation();
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  if (!editingMessage && !replyToMessage) return null;

  return (
    <div className="thread-composer-context">
      <span>
        {editingMessage
          ? t('editingMessage', 'Редактирование')
          : `${t('replyTo', 'Ответ')}: ${getMessagePreview(replyToMessage)}`}
      </span>

      <button
        aria-label={t('cancel', 'Отменить')}
        className="thread-composer-close-btn"
        onClick={onCancel}
        type="button"
      >
        <Icon name="cross" size="sm" />
      </button>
    </div>
  );
};
