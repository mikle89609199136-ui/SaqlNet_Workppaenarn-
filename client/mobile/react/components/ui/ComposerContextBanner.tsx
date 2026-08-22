import { useChatStore } from '@/store';
import { getMessagePreview } from '@/utils';
import { useTranslation } from 'react-i18next';

interface Props {
  onCancel: () => void;
}

export const ComposerContextBanner = ({ onCancel }: Props) => {
  const { t } = useTranslation();
  const editingMessage = useChatStore((state) => state.editingMessage);
  const replyToMessage = useChatStore((state) => state.replyToMessage);
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
        <svg
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
          width="14"
        >
          <line x1="18" x2="6" y1="6" y2="18" />
          <line x1="6" x2="18" y1="6" y2="18" />
        </svg>
      </button>
    </div>
  );
};
