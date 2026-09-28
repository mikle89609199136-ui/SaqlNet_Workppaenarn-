import { Icon } from '@/shared/ui';
import { cn, formatFileSize, useObjectUrl } from '@/shared/lib';
import type { IPendingAttachment } from '@/types';
import { useTranslation } from 'react-i18next';

interface Props {
  attachment: IPendingAttachment | null;
  onRemove: () => void;
  onEdit?: (file: File) => void;
  onOpenImage?: (url: string) => void;
}

/* Круглая кнопка в углу плашки: «убрать» сверху справа, «изменить» у
   фото снизу справа. Цвет — перевёрнутый, чтобы читалась на любой плашке. */
const cornerButton = cn(
  'absolute flex size-5.5 cursor-pointer items-center justify-center rounded-pill',
  'border-2 border-composer bg-ink text-composer',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
);

/* Расширение для плитки файла: «PDF», «ZIP». Без расширения — «ФАЙЛ». */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5).toUpperCase() : '';
}

/**
 * Вложение над полем ввода — по макету (#821): фото — плитка 72 с
 * превью, файл — карточка 220×72 с плиткой расширения, именем и размером.
 */
export const AttachmentPreview = ({ attachment, onRemove, onEdit, onOpenImage }: Props) => {
  const { t } = useTranslation();
  const isImageFile = Boolean(attachment?.file && attachment.file.type.startsWith('image/'));
  const previewUrl = useObjectUrl(isImageFile ? attachment?.file : null);

  if (!attachment) return null;

  const isImage = attachment.type === 'image';
  const { name, size } = attachment.file;

  return (
    <div
      aria-label={t('attachments', 'Вложения')}
      className="flex flex-wrap gap-2 px-2.5 pt-2.5 pb-1"
      role="group"
    >
      <div className="relative">
        {isImage && previewUrl ? (
          <button
            aria-label={`${t('openImage', 'Открыть изображение')}: ${name}`}
            className="block size-18 cursor-pointer overflow-hidden rounded-button focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            onClick={() => onOpenImage?.(previewUrl)}
            type="button"
          >
            <img alt="" className="size-full object-cover" src={previewUrl} />
          </button>
        ) : (
          <div className="flex h-18 w-55 items-center gap-2.5 rounded-button bg-sheet-2 pr-7.5 pl-2.5">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-field bg-brand-fill text-micro font-bold text-on-brand"
            >
              {extensionOf(name) || <Icon className="size-5" name="file" />}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-caption font-medium text-ink">{name}</span>
              <span className="text-meta text-ink-3">{formatFileSize(size)}</span>
            </span>
          </div>
        )}

        <button
          aria-label={t('deleteAttachment', 'Удалить вложение')}
          className={cn(cornerButton, '-top-1.5 -right-1.5')}
          onClick={onRemove}
          title={t('deleteAttachment', 'Удалить вложение')}
          type="button"
        >
          <Icon className="size-2.75 stroke-3" name="cross" />
        </button>

        {isImage && onEdit && (
          <button
            aria-label={t('editAttachment', 'Редактировать фото')}
            className={cn(cornerButton, '-right-1.5 -bottom-1.5')}
            onClick={() => onEdit(attachment.file)}
            title={t('editAttachment', 'Редактировать фото')}
            type="button"
          >
            <Icon className="size-2.75 stroke-3" name="edit" />
          </button>
        )}
      </div>
    </div>
  );
};
