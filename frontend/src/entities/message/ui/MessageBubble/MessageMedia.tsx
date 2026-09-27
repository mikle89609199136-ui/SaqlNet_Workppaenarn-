import { AudioPlayer, Icon, VideoPlayer } from '@/shared/ui';
import type { IMessageDto } from '../../model/types';
import { formatFileSize } from '@/shared/lib';
import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
  onOpenImage: Dispatch<SetStateAction<string | null>>;
}

export const MessageMedia = ({ message, onOpenImage }: Props) => {
  const { t } = useTranslation();
  const { mediaUnavailable, mediaUnavailableReason, mediaUrl, mediaType, type, mediaEncryption } =
    message;

  if (mediaUnavailable) {
    return (
      <div className="message-media-unavailable">
        {mediaUnavailableReason ??
          t('mediaUnavailableUnencrypted', 'Медиа недоступно: файл не зашифрован')}
      </div>
    );
  }

  if (!mediaUrl) return null;

  const actualType = mediaType || type;

  if (['image', 'gif', 'sticker'].includes(actualType)) {
    return (
      <button
        aria-label={t('openImage', 'Открыть изображение')}
        className="message-media-open"
        onClick={() => onOpenImage(mediaUrl)}
        type="button"
      >
        <img alt="" className={`message-media message-media-${actualType}`} src={mediaUrl} />
      </button>
    );
  }

  if (['video', 'audio'].includes(actualType) || actualType === 'voice') {
    if (actualType === 'video') {
      return (
        <div className="mt-1 mb-2 w-full max-w-sm">
          <VideoPlayer src={mediaUrl} />
        </div>
      );
    }

    return (
      <div className="mt-1 mb-2 w-full">
        <AudioPlayer src={mediaUrl} />
      </div>
    );
  }

  if (actualType === 'file') {
    const meta = message.metadata && 'fileName' in message.metadata ? message.metadata : undefined;
    const fileName =
      mediaEncryption?.fileName ?? meta?.fileName ?? message.content ?? t('file', 'Файл');
    const sizeBytes = mediaEncryption?.sizeBytes ?? meta?.sizeBytes;

    return (
      <a
        className="message-media-file mb-1 flex items-center gap-2.5 no-underline"
        download={fileName}
        href={mediaUrl}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-soft text-brand group-data-[mine]/bubble:bg-on-brand/16 group-data-[mine]/bubble:text-on-brand"
        >
          <Icon className="size-5" name="file" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-semibold">{fileName}</span>
          {typeof sizeBytes === 'number' && (
            <span className="text-meta text-ink-3 group-data-[mine]/bubble:text-out-meta">
              {formatFileSize(sizeBytes)}
            </span>
          )}
        </div>
      </a>
    );
  }

  return null;
};
