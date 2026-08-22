import { Icon } from '@/components/ui';
import type { IMessageDto } from '@/types';
import { formatFileSize } from '@/utils';
import React, { type Dispatch, type SetStateAction } from 'react';
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

  if (['video', 'audio'].includes(actualType)) {
    return React.createElement(actualType, {
      className: 'message-media',
      controls: true,
      src: mediaUrl,
    });
  }
  if (actualType === 'voice') {
    return <audio className="message-media" controls src={mediaUrl} />;
  }

  if (actualType === 'file') {
    return (
      <a className="message-media-file flex gap-x-1" download href={mediaUrl}>
        <Icon name="file" className="size-9" />
        <div className="flex flex-col">
          <span className="text-sm">{mediaEncryption.fileName}</span>
          <span className="text-xs text-[rgba(255,255,255,0.58)]">
            {formatFileSize(mediaEncryption.sizeBytes)}
          </span>
        </div>
      </a>
    );
  }

  return null;
};
