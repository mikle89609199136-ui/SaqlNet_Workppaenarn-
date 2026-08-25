import type { IPendingAttachment } from '@/types';
import { formatFileSize, getAttachmentIcon } from '@/utils';
import { useTranslation } from 'react-i18next';

interface Props {
  attachment: IPendingAttachment | null;
  onRemove: () => void;
}

export const AttachmentPreview = ({ attachment, onRemove }: Props) => {
  const { t } = useTranslation();

  if (!attachment) return;

  return (
    <div className="thread-attachment-preview">
      <div className="flex flex-start items-center gap-x-1">
        <span aria-hidden="true">{getAttachmentIcon(attachment.type)}</span>
        <span title={attachment.file.name}>{attachment.file.name}</span>
        <span className="flex items-center text-xs text-[rgba(255,255,255,0.5)] text-nowrap">
          {formatFileSize(attachment.file.size)}
        </span>
      </div>
      <button
        aria-label={t('removeAttachment', 'Убрать вложение')}
        className="thread-composer-close-btn"
        onClick={onRemove}
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
