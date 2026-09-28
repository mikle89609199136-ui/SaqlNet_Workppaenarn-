import { Button, Icon } from '@/shared/ui';
import { usePinnedNavigator } from '../model/usePinnedNavigator';
import type { IMessageDto, TPinnedList } from '@/types';
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
    return <span>{message.content}</span>;
  }

  switch (message.type) {
    case 'video':
      return (
        <span className="inline-flex items-center gap-1 align-bottom">
          <Icon name="video" size="sm" className="shrink-0" />
          <span>{t('media.video', 'Видео')}</span>
        </span>
      );
    case 'audio':
      return (
        <span className="inline-flex items-center gap-1 align-bottom">
          <Icon name="volume" size="sm" className="shrink-0" />
          <span>{t('media.audio', 'Аудиозапись')}</span>
        </span>
      );
    case 'voice':
      return (
        <span className="inline-flex items-center gap-1 align-bottom">
          <Icon name="volume" size="sm" className="shrink-0" />
          <span>{t('media.voice', 'Голосовое сообщение')}</span>
        </span>
      );
    case 'image':
      return (
        <span className="inline-flex items-center gap-1 align-bottom">
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
        <span className="inline-flex items-center gap-1 align-bottom">
          <Icon name="file" size="sm" className="shrink-0" />
          <span>{fileName}</span>
        </span>
      );
    }
    case 'call':
      return (
        <span className="inline-flex items-center gap-1 align-bottom">
          <Icon name="phone" size="sm" className="shrink-0" />
          <span>{t('call.title', 'Звонок')}</span>
        </span>
      );
    default:
      return (
        <span>{message.content || t('pinnedMessages.default', 'Закреплённое сообщение')}</span>
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
    /* Полоска закреплённого под шапкой — по макету (#820): 52px, слева
       столбик сегментов (текущий — акцентом), подпись с номером и строка
       текста; клик ведёт к сообщению и листает дальше. */
    <div className="sticky top-0 z-10 flex h-13 shrink-0 items-center gap-2.5 border-b border-divider bg-chat-bg pr-3 pl-4">
      <button
        className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-field text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
        aria-label={t('pinnedMessagesAria', 'Закреплённые сообщения')}
        onClick={handleClick}
        type="button"
      >
        <div className="relative h-8.5 w-[3px] shrink-0 overflow-hidden" aria-hidden="true">
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
                  'w-full shrink-0 rounded-[2px] bg-line-soft transition-colors duration-[160ms]',
                  index === safeIndex && 'bg-brand'
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-px text-caption">
          <span className="truncate font-semibold text-brand">
            {t('pinnedMessages', 'Закреплённое сообщение')}
            {messages.length > 1
              ? ` · ${t('pinnedMessages.position', '{{current}} из {{total}}', {
                  current: currentMessageNumber,
                  total: messages.length,
                })}`
              : ''}
          </span>
          <div className="min-w-0 truncate text-ink-2">
            {senderTitle ? `${senderTitle}: ` : ''}
            {renderMessageSnippet(currentMessage, t)}
          </div>
        </div>
      </button>
      <Button
        variant="ghost"
        iconOnly
        className="shrink-0 rounded-icon text-ink-3"
        aria-label={t('pinnedMessages.viewAll', 'Показать все закреплённые сообщения')}
        onClick={() => setPinnedMessagesOpen(true)}
      >
        <Icon className="size-4.5" name="list" />
      </Button>
    </div>
  );
};
