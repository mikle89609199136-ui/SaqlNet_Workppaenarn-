import { Icon } from '@/components/ui/Icon';
import { useChatUiStore } from '@/store';
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
    const selectionMode = useChatUiStore((state) => state.selectionMode);

    const targetReplyId = message.replyTo || message.replyToMessageId;
    const hasReply = Boolean(
      targetReplyId || message.replyToContent || message.replyToMediaUrl || repliedMessage
    );
    if (!hasReply) return null;

    const mediaUrl = repliedMessage?.mediaUrl || message.replyToMediaUrl || null;
    const actualType =
      repliedMessage?.mediaType ||
      (repliedMessage?.type && repliedMessage.type !== 'text' && repliedMessage.type !== 'call'
        ? repliedMessage.type
        : null) ||
      message.replyToMediaType ||
      null;

    const isVideo = actualType === 'video';
    const isVoice = actualType === 'voice';
    const isAudio = actualType === 'audio' || isVoice;
    const isFile = actualType === 'file';
    const isCall = actualType === 'call' || repliedMessage?.type === 'call';
    const isSticker = actualType === 'sticker';
    const isGif = actualType === 'gif';
    const isImage =
      actualType === 'image' || (!actualType && Boolean(mediaUrl) && !isFile && !isVideo && !isAudio);

    const senderTitle =
      message.replyToSenderName ||
      message.replySenderName ||
      repliedMessage?.senderName ||
      repliedMessage?.senderFirstName ||
      t('reply', 'Ответ');

    const textSnippet =
      repliedMessage?.content?.trim() || message.replyToContent?.trim() || '';

    let typeLabel = '';
    if (isImage) {
      typeLabel = t('lastMessage.image', 'Фотография');
    } else if (isVideo) {
      typeLabel = t('lastMessage.video', 'Видео');
    } else if (isVoice) {
      typeLabel = t('lastMessage.voice', 'Голосовое сообщение');
    } else if (isAudio) {
      typeLabel = t('lastMessage.audio', 'Аудио');
    } else if (isFile) {
      typeLabel = t('lastMessage.file', 'Файл');
    } else if (isCall) {
      typeLabel = t('lastMessage.call', 'Звонок');
    } else if (isSticker) {
      typeLabel = t('lastMessage.sticker', 'Стикер');
    } else if (isGif) {
      typeLabel = t('lastMessage.gif', 'Гиф');
    }

    let displayText = '';
    if (repliedMessage?.undecryptable) {
      displayText = `🔒 ${t(`undecryptable.${repliedMessage.undecryptable}`, repliedMessage.content)}`;
    } else if (textSnippet && typeLabel && !isImage) {
      displayText = `${typeLabel}: ${textSnippet}`;
    } else if (textSnippet) {
      displayText = textSnippet;
    } else {
      displayText = typeLabel || t('message', 'Сообщение');
    }

    const canJump = Boolean(targetReplyId && onJumpToMessage);

    return (
      <div
        aria-label={t('goToMessage', 'Перейти к сообщению')}
        className={cn(
          'mb-1 flex items-center gap-2 rounded-field bg-line/60 hover:bg-line/90 text-left transition-colors',
          canJump ? 'cursor-pointer' : 'cursor-default',
          'border-l-[3px] border-brand pl-2 pr-2 py-1 max-w-full overflow-hidden select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
        )}
        onClick={(event) => {
          if (selectionMode) {
            // В режиме мультивыбора клик должен всплывать для выделения сообщения
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (targetReplyId && onJumpToMessage) {
            onJumpToMessage(targetReplyId);
          }
        }}
        onKeyDown={(event) => {
          if (selectionMode) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (targetReplyId && onJumpToMessage) {
              onJumpToMessage(targetReplyId);
            }
          }
        }}
        role="button"
        tabIndex={canJump ? 0 : undefined}
      >
        {/* Медиа-превью слева */}
        {isImage && mediaUrl && (
          <img
            alt=""
            className="size-9 rounded-control object-cover shrink-0 bg-black/10"
            src={mediaUrl}
          />
        )}

        {isVideo && (
          <div className="size-9 rounded-control bg-black/40 text-white flex items-center justify-center shrink-0">
            <Icon className="size-4 fill-white ml-0.5" name="play" />
          </div>
        )}

        {isAudio && (
          <div className="size-9 rounded-control bg-brand-soft text-brand flex items-center justify-center shrink-0">
            <Icon className="size-4" name="volume" />
          </div>
        )}

        {isFile && (
          <div className="size-9 rounded-control bg-sheet-2 text-ink-2 flex items-center justify-center shrink-0">
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
