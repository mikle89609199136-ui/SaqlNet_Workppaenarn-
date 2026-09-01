import { Icon } from '@/components/ui';
import { useChatUiStore } from '@/store';
import type { IMessageDto, TPinnedList } from '@/types';
import { cn } from '@/utils';
import type { TFunction } from 'i18next';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';

const MAX_VISIBLE_SEGMENTS = 4;

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
        (message as unknown as { fileName?: string }).fileName ||
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
  const trackRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setHighlightedMessageId = useChatUiStore((state) => state.setHighlightedMessageId);
  const { t } = useTranslation();

  const [currentPinnedMessageIndex, setCurrentPinnedMessageIndex] = useState<number | null>(null);

  useEffect(() => {
    setCurrentPinnedMessageIndex(messages.length ? messages.length - 1 : null);
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  if (!messages.length) return null;

  const safeIndex = Math.min(
    currentPinnedMessageIndex ?? (messages.length - 1),
    messages.length - 1
  );
  const currentMessage = messages[safeIndex]?.message;

  if (!currentMessage) return null;

  const totalSegments = messages.length;
  const visibleSegments = Math.min(totalSegments, MAX_VISIBLE_SEGMENTS);
  const isFilling = totalSegments <= MAX_VISIBLE_SEGMENTS;
  const maxWindowStart = Math.max(totalSegments - visibleSegments, 0);
  const windowStart = Math.min(
    Math.max(safeIndex - visibleSegments + 1, 0),
    maxWindowStart
  );

  const handleClick = () => {
    requestAnimationFrame(() => {
      const el = document.getElementById(currentMessage.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    if (setHighlightedMessageId) {
      setHighlightedMessageId(currentMessage.id);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1500);
    }

    if (safeIndex === 0 && trackRef.current) {
      trackRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = '';
      });
    }

    setCurrentPinnedMessageIndex((prev) => {
      const current = prev ?? (messages.length - 1);
      return current === 0 ? messages.length - 1 : current - 1;
    });
  };

  const currentMessageNumber = safeIndex + 1;
  const senderTitle = currentMessage.senderFirstName || currentMessage.senderName || '';

  return (
    <div className="flex items-center gap-x-2 transition-colors border-b border-line bg-sheet-2/60 hover:bg-sheet-2 py-1.5 md:py-3 px-2 pr-3">
      <button
        className="w-full flex gap-2 cursor-pointer outline-0 text-left min-w-0"
        aria-label={t('pinnedMessagesAria', 'Закреплённые сообщения')}
        onClick={handleClick}
        type="button"
      >
        <div
          className="w-0.5 shrink-0 overflow-hidden"
          aria-hidden="true"
          style={{ '--pm-visible': visibleSegments } as CSSProperties}
        >
          <div
            ref={trackRef}
            className={cn(
              'flex flex-col gap-0.5 h-full transition-transform translate-y-[calc(-1*var(--pm-window-start,0)*(var(--pm-segment-h)+var(--pm-gap)))]',
              isFilling && 'pinned-messages__track--fill'
            )}
            style={{ '--pm-window-start': windowStart } as CSSProperties}
          >
            {messages.map((message, index) => (
              <span
                key={message.messageId}
                className={cn(
                  'shrink-0 flex rounded-pill bg-line-soft h-[var(--pm-segment-h)]',
                  isFilling && 'flex-1 min-h-2',
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
          <div className="min-w-0 truncate">
            {renderMessageSnippet(currentMessage, t)}
          </div>
        </div>
      </button>
      <button
        type="button"
        className="shrink-0 p-1.5 rounded-control text-ink-2 hover:text-ink hover:bg-sheet-3 transition-colors cursor-pointer rotate-45"
        aria-label={t('pinnedMessages.viewAll', 'Показать все закреплённые сообщения')}
        onClick={() => setPinnedMessagesOpen(true)}
      >
        <Icon name="pin" size="sm" />
      </button>
    </div>
  );
};
