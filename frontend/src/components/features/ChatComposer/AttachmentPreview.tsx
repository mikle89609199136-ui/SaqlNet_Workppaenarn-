import { Button, Icon } from '@/components/ui';
import { useObjectUrl } from '@/hooks';
import type { IPendingAttachment } from '@/types';
import { formatFileSize } from '@/utils';
import { useTranslation } from 'react-i18next';

interface Props {
  attachment: IPendingAttachment | null;
  onRemove: () => void;
  onEdit?: (file: File) => void;
  onOpenImage?: (url: string) => void;
}

export const AttachmentPreview = ({
  attachment,
  onRemove,
  onEdit,
  onOpenImage,
}: Props) => {
  const { t } = useTranslation();
  const isImageFile = Boolean(attachment?.file && attachment.file.type.startsWith('image/'));
  const previewUrl = useObjectUrl(isImageFile ? attachment?.file : null);

  if (!attachment) return null;

  const isImage = attachment.type === 'image';

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-field bg-line-soft border border-line-soft text-ink">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isImage && previewUrl ? (
          <button
            aria-label={t('openImage', 'Открыть изображение')}
            className="border-0 p-0 bg-transparent cursor-pointer shrink-0"
            onClick={() => onOpenImage?.(previewUrl)}
            type="button"
          >
            <img
              alt=""
              className="w-9 h-9 rounded-control object-cover border border-line shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
              src={previewUrl}
            />
          </button>
        ) : (
          <div className="w-9 h-9 rounded-control bg-sheet-2 border border-line flex items-center justify-center text-ink-2 shrink-0">
            <Icon name="file" size="sm" />
          </div>
        )}

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-body font-medium text-ink truncate leading-tight">
              {attachment.file.name}
            </span>
            <span className="text-caption text-ink-3 font-normal shrink-0">
              {formatFileSize(attachment.file.size)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isImage && onEdit && (
          <Button
            aria-label={t('editAttachment', 'Редактировать фото')}
            className="rounded-full size-7 min-h-0 p-0 flex items-center justify-center shrink-0"
            iconOnly
            onClick={() => onEdit(attachment.file)}
            size="sm"
            title={t('editAttachment', 'Редактировать фото')}
            variant="ghost"
          >
            <Icon name="edit" size="sm" />
          </Button>
        )}
        <Button
          aria-label={t('deleteAttachment', 'Удалить вложение')}
          className="rounded-full size-7 min-h-0 p-0 flex items-center justify-center shrink-0"
          iconOnly
          onClick={onRemove}
          size="sm"
          title={t('deleteAttachment', 'Удалить вложение')}
          variant="ghost"
        >
          <Icon name="cross" size="sm" />
        </Button>
      </div>
    </div>
  );
};
