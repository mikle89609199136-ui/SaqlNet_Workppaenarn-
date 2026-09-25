import { Button, Icon } from '@/shared/ui';
import { usePinnedNavigator } from '../model/usePinnedNavigator';
import type { IMessageDto, TPinnedList } from '@/entities/message';
import { cn } from '@/shared/lib';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  messages: TPinnedList;
  setPinnedMessagesOpen: Dispatch<SetStateAction<boolean>>;
}

export function renderMessageSnippet(message: IMessageDto, t: TFunction) {
  if (message.content) {
    return <p className="pinned-messages__text truncate">{message.content}</p>;
  }

  switch (message.type) {
    case 'video':
      return (
        <span className="flex items-center gap-1 text-ink-2 text-sm truncate">
          <Icon name="video" size="sm" className="shrink-0" />
          <span>{t('media.video', 'Видео')}</span>
        </span>
      );
    case 'audio':
      return (
        <span className="flex items-center gap-1 text-ink-2 text-sm truncate">
          <Icon name="volume" size="sm" className="shrink-0" />
          <span>{t('media.audio', 'Аудиозапись')}</span>
        </span>
      );
    case 'voice':
      return (
        <span className="flex items-center gap-1 text-ink-2 text-sm truncate">
          <Icon name="volume" size="sm" className="shrink-0" />
          <span>{t('media.voice', 'Голосовое сообщение')}</span>
        </span>
      );
    case 'image':
      return (
        <span className="flex items-center gap-1 text-ink-2 text-sm truncate">
          <Icon name="camera" size="sm" className="shrink-0" />
          <span>{t('media.photo', 'Фотография')}</span>
        </span>
      );
    case 'file': {
      const fileName =
        message.mediaEncryption?.fileName ||
        (message.metadata && 'fileName' in message.metadata
          ? message.metadata.fileName
          : undefined) ||
        t('media.file', 'Файл');
      return (
        <span className="flex items-center gap-1 text-ink-2 text-sm truncate">
          <Icon name="file" size="sm" className="shrink-0" />
          <span>{fileName}</span>
        </span>
      );
    }
    case 'call':
      return (
        <span className="flex items-center gap-1 text-ink-2 text-sm truncate">
          <Icon name="phone" size="sm" className="shrink-0" />
          <span>{t('call.title', 'Звонок')}</span>
        </span>
      );
    default:
      return (
        <p className="pinned-messages__text truncate">
          {message.content || t('pinnedMessages.default', 'Закреплённое сообщение')}
        </p>
      );
  }
}

export const PinnedMessagesNavigator = ({ messages, setPinnedMessagesOpen }: Props) => {
  const { t } = useTranslation();
  const {
    trackRef,
    safeIndex,
    currentMessage,
    visibleSegments,
    isFilling,
    windowStart,
    currentMessageNumber,
    senderTitle,
    handleClick,
  } = usePinnedNavigator(messages);

  if (!messages.length || !currentMessage) return null;

  const segmentHeightCalc = `calc((100% - (${visibleSegments} - 1) * 2px) / ${visibleSegments})`;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-x-2 transition-colors border-b border-line bg-sheet/85 backdrop-blur-md py-1.5 md:py-2.5 px-2 pr-3 shadow-xs">
      <Button
        variant="ghost"
        className="w-full flex !items-stretch gap-2 cursor-pointer outline-0 text-left min-w-0 p-0 border-0 hover:bg-transparent font-normal justify-start"
        aria-label={t('pinnedMessagesAria', 'Закреплённые сообщения')}
        onClick={handleClick}
      >
        <div
          className="relative w-0.5 shrink-0 overflow-hidden self-stretch my-0.5"
          aria-hidden="true"
        >
          <div
            ref={trackRef}
            className="absolute inset-0 flex flex-col gap-0.5 transition-transform duration-200 ease-out"
            style={{
              transform: isFilling
                ? undefined
                : `translateY(calc(-1 * ${windowStart} * (${segmentHeightCalc} + 2px)))`,
            }}
          >
            {messages.map((message, index) => (
              <span
                key={message.messageId}
                style={{
                  height: segmentHeightCalc,
                }}
                className={cn(
                  'shrink-0 w-full rounded-pill bg-line-soft transition-colors',
                  index === safeIndex && 'bg-brand-fill'
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col border-0 bg-transparent text-left min-w-0 flex-1">
          <span className="text-caption font-medium text-brand truncate">
            {t('pinnedMessages', 'Закреплённое сообщение')} #{currentMessageNumber}
            {senderTitle ? ` • ${senderTitle}` : ''}
          </span>
          <div className="min-w-0 truncate">{renderMessageSnippet(currentMessage, t)}</div>
        </div>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        className="shrink-0 rotate-45"
        aria-label={t('pinnedMessages.viewAll', 'Показать все закреплённые сообщения')}
        onClick={() => setPinnedMessagesOpen(true)}
      >
        <Icon name="pin" size="sm" />
      </Button>
    </div>
  );
};
