import { Icon } from '@/components/ui';
import type { IPendingAttachment } from '@/types';
import { formatFileSize } from '@/utils';
import { useTranslation } from 'react-i18next';

interface Props {
  attachment: IPendingAttachment | null;
  onRemove: () => void;
}

export const AttachmentPreview = ({ attachment, onRemove }: Props) => {
  const { t } = useTranslation();
  if (!attachment) return null;

  return (
    <div className="thread-attachment-preview">
      {attachment.previewUrl && (
        <img alt="" className="thread-attachment-thumb" src={attachment.previewUrl} />
      )}
      <div className="thread-attachment-meta">
        <span className="thread-attachment-name">{attachment.name}</span>
        <span className="thread-attachment-size">{formatFileSize(attachment.size)}</span>
      </div>
      <button
        aria-label={t('deleteAttachment', 'Удалить вложение')}
        className="thread-composer-close-btn"
        onClick={onRemove}
        type="button"
      >
        <Icon name="cross" size="sm" />
      </button>
    </div>
  );
};
