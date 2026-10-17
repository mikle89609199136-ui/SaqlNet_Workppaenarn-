import { Icon } from '@/shared/ui/Icon';
import { useChatUiStore } from '@/entities/chat';
import type { IMediaItem, IMessageDto, TMediaMessageType } from '../../model/types';
import { cn } from '@/shared/lib';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  message: IMessageDto;
  repliedMessage?: IMediaItem;
  onJumpToMessage?: (messageId: string) => void;
  /** Цитата в своём пузыре — на заливке акцента, белым. */
  mine?: boolean;
}

/**
 * Плашка ответа на сообщение (reply preview) внутри MessageBubble.
 * Поддерживает предпросмотр любых типов сообщений (фото, видео, аудио, файлы, текст),
 * доступна для скринридеров и навигации с клавиатуры, корректно отображается,
 * даже если исходное сообщение еще не загружено в локальный срез ленты.
 */
export const MessageReplyPreview = memo(
  ({ message, repliedMessage, onJumpToMessage, mine = false }: Props) => {
    const { t } = useTranslation();
    const selectionMode = useChatUiStore((state) => state.selectionMode);

    const targetReplyId = message.replyTo || message.replyToMessageId;
    const hasReply = Boolean(targetReplyId || repliedMessage);
    if (!hasReply) return null;

    /* Исходник в ленте — первым: в нём живые правки и расшифрованное медиа.
       Нет его — превью от сервера (#1065): иначе ответ на давнее сообщение
       показывал одно слово «Сообщение». У превью нет файла, поэтому для
       фото и видео — только подпись типа. */
    const preview = repliedMessage ? undefined : message.replyPreview;
    const sourceType = repliedMessage?.type ?? preview?.type;

    const mediaUrl =
      repliedMessage?.mediaUrl ||
      (repliedMessage?.metadata as { mediaUrl?: string })?.mediaUrl ||
      null;
    const actualType =
      repliedMessage?.mediaType ||
      (repliedMessage?.metadata as { mediaType?: TMediaMessageType })?.mediaType ||
      (sourceType && sourceType !== 'text' && sourceType !== 'call' ? sourceType : null) ||
      null;

    const isVideo = actualType === 'video';
    const isVoice = actualType === 'voice';
    const isAudio = actualType === 'audio' || isVoice;
    const isFile = actualType === 'file';
    const isCall = actualType === 'call' || sourceType === 'call';
    const isSticker = actualType === 'sticker';
    const isGif = actualType === 'gif';
    const isImage =
      actualType === 'image' ||
      (!actualType && Boolean(mediaUrl) && !isFile && !isVideo && !isAudio);

    const senderTitle =
      message.replyToSenderName ||
      message.replySenderName ||
      repliedMessage?.senderName ||
      repliedMessage?.senderFirstName ||
      preview?.senderName ||
      t('replyTo', 'Ответ');

    // У звонка в content служебный JSON, а не текст.
    const textSnippet = isCall ? '' : (repliedMessage?.content ?? preview?.content ?? '').trim();
    const undecryptable = repliedMessage?.undecryptable ?? preview?.undecryptable;

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
    if (undecryptable) {
      displayText = `🔒 ${t(`undecryptable.${undecryptable}`, textSnippet)}`;
    } else if (textSnippet && typeLabel && !(isImage && mediaUrl)) {
      // Миниатюры нет — тип называем словами.
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
          /* По макету (#820): плашка на 4px шире текста с каждой стороны,
           полоса 3px, имя и строка текста 13px. Не выходит за пузырь:
           ширина считается от него, длинный текст режется многоточием. */
          '-mx-1 -mt-0.5 mb-1.5 flex w-[calc(100%+8px)] max-w-[calc(100%+8px)] items-center gap-2 overflow-hidden',
          'rounded-field px-2.5 py-1.5 text-left select-none transition-colors',
          mine ? 'bg-on-brand/16' : 'bg-brand-soft',
          canJump ? 'cursor-pointer hover:layer-hover' : 'cursor-default',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
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
        <span
          aria-hidden="true"
          className={cn(
            'w-[3px] shrink-0 self-stretch rounded-[2px]',
            mine ? 'bg-on-brand' : 'bg-brand'
          )}
        />

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
        <div className="flex min-w-0 flex-1 flex-col gap-px text-caption leading-[1.35]">
          <span className={cn('truncate font-semibold', mine ? 'text-on-brand' : 'text-brand')}>
            {senderTitle}
          </span>
          <span className={cn('truncate', mine ? 'text-on-brand/85' : 'text-ink-2')}>
            {displayText}
          </span>
        </div>
      </div>
    );
  }
);

MessageReplyPreview.displayName = 'MessageReplyPreview';
