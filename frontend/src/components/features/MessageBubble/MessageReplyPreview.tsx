import { Icon } from '@/components/ui/Icon';
import type { IMediaItem, IMessageDto } from '@/types';
import { cn } from '@/utils';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
  repliedMessage?: IMediaItem;
  onJumpToMessage?: (messageId: string) => void;
}

/**
 * Плашка ответа на сообщение (reply preview) внутри MessageBubble.
 * Поддерживает предпросмотр любых типов сообщений (фото, видео, аудио, файлы, текст),
 * доступна для скринридеров и навигации с клавиатуры, корректно отображается,
 * даже если исходное сообщение еще не загружено в локальный срез ленты.
 */
export const MessageReplyPreview = memo(
  ({ message, repliedMessage, onJumpToMessage }: Props) => {
    const { t } = useTranslation();

    if (!message.replyTo) return null;

    const mediaUrl = repliedMessage?.mediaUrl || message.replyToMediaUrl || null;
    const actualType =
      repliedMessage?.mediaType ||
      (repliedMessage?.type && repliedMessage.type !== 'text' && repliedMessage.type !== 'call'
        ? repliedMessage.type
        : null);

    const isVideo =
      actualType === 'video' || (Boolean(mediaUrl) && /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(mediaUrl!));
    const isAudio = actualType === 'audio' || actualType === 'voice';
    const isVoice = actualType === 'voice';
    const isFile = actualType === 'file';
    const isCall = repliedMessage?.type === 'call';
    const isImage = !isVideo && !isAudio && (actualType === 'image' || Boolean(mediaUrl));

    const senderTitle =
      message.replyToSenderName ||
      message.replySenderName ||
      repliedMessage?.senderName ||
      t('reply', 'Ответ');

    const textSnippet =
      repliedMessage?.content?.trim() || message.replyToContent?.trim() || '';

    let typeLabel = '';
    if (isImage) {
      typeLabel = t('photoPrefix', '📷 Фото');
    } else if (isVideo) {
      typeLabel = t('videoPrefix', '📹 Видео');
    } else if (isVoice) {
      typeLabel = t('voicePrefix', '🎤 Голос');
    } else if (isAudio) {
      typeLabel = t('audioPrefix', '🎵 Аудио');
    } else if (isFile) {
      typeLabel = t('filePrefix', '📎 Файл');
    } else if (isCall) {
      typeLabel = t('callPrefix', '📞 Звонок');
    }

    const displayText = textSnippet
      ? typeLabel
        ? `${typeLabel}: ${textSnippet}`
        : textSnippet
      : typeLabel || t('originalMessage', 'Сообщение');

    return (
      <div
        aria-label={t('goToMessage', 'Перейти к сообщению')}
        className={cn(
          'mb-1 flex items-center gap-2 rounded-md bg-line/60 hover:bg-line/90 text-left cursor-pointer transition-colors',
          'border-l-[3px] border-brand pl-2 pr-2 py-1 max-w-full overflow-hidden select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (message.replyTo && onJumpToMessage) {
            onJumpToMessage(message.replyTo);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (message.replyTo && onJumpToMessage) {
              onJumpToMessage(message.replyTo);
            }
          }
        }}
        role="button"
        tabIndex={0}
      >
        {/* Медиа-превью слева */}
        {isImage && mediaUrl && (
          <img
            alt=""
            className="size-9 rounded object-cover shrink-0 bg-black/10"
            src={mediaUrl}
          />
        )}

        {isVideo && (
          <div className="relative size-9 rounded overflow-hidden bg-black/40 flex items-center justify-center shrink-0">
            {mediaUrl ? (
              <video
                className="w-full h-full object-cover pointer-events-none"
                muted
                preload="metadata"
                src={mediaUrl}
              />
            ) : null}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <Icon className="size-3.5 text-white fill-white ml-0.5" name="play" />
            </div>
          </div>
        )}

        {isAudio && (
          <div className="size-9 rounded bg-brand/10 text-brand flex items-center justify-center shrink-0">
            <Icon className="size-4" name="volume" />
          </div>
        )}

        {isFile && (
          <div className="size-9 rounded bg-line text-ink-2 flex items-center justify-center shrink-0">
            <Icon className="size-4" name="file" />
          </div>
        )}

        {/* Текстовая колонка */}
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <span className="text-micro font-semibold text-brand truncate leading-tight">
            {senderTitle}
          </span>
          <span className="text-xs text-ink-2 truncate font-normal leading-snug">
            {displayText}
          </span>
        </div>
      </div>
    );
  }
);

MessageReplyPreview.displayName = 'MessageReplyPreview';
