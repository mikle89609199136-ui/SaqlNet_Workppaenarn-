import { Icon } from '@/components/ui';
import type { TPinnedList } from '@/types';
import { cn } from '@/utils';
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

export const PinnedMessages = ({ messages, setPinnedMessagesOpen }: Props) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const [currentPinnedMessageIndex, setCurrentPinnedMessageIndex] = useState<number | null>(null);

  useEffect(() => {
    setCurrentPinnedMessageIndex(messages.length ? messages.length - 1 : null);
  }, [messages.length]);

  if (!messages.length) return null;

  const safeIndex = Math.min(currentPinnedMessageIndex ?? 0, messages.length - 1);
  const currentMessage = messages[safeIndex]?.message;

  if (!currentMessage) return null;

  const totalSegments = messages.length;
  const visibleSegments = Math.min(totalSegments, MAX_VISIBLE_SEGMENTS);
  const isFilling = totalSegments <= MAX_VISIBLE_SEGMENTS;
  const maxWindowStart = Math.max(totalSegments - visibleSegments, 0);
  const windowStart = Math.min(
    Math.max(currentPinnedMessageIndex! - visibleSegments + 1, 0),
    maxWindowStart
  );

  const handleClick = () => {
    requestAnimationFrame(() => {
      const el = document.getElementById(currentMessage.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    if (currentPinnedMessageIndex === 0 && trackRef.current) {
      trackRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = '';
      });
    }

    setCurrentPinnedMessageIndex((prev) => (prev === 0 ? messages.length - 1 : prev! - 1));
  };
	const currentMessageNumber = currentPinnedMessageIndex + 1;
  return (
    <div className="flex items-center gap-x-2 transition-colors border-b border-border bg-panel hover:bg-[rgba(255,255,255,0.05)] py-1.5 md:py-3 px-2 pr-4">
      <button
        className="w-full flex gap-2 cursor-pointer outline-0"
        aria-label="Закреплённые сообщения"
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
                  'shrink-0 flex rounded-full bg-gray-600 h-[var(--pm-segment-h)]',
                  isFilling && 'flex-1 min-h-2',
                  index === currentPinnedMessageIndex && 'bg-[#2b77e7]'
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col border-0 bg-transparent text-left max-w-9/10">
          <span className="text-sm font-medium text-[#2b77e7] text-sm md:text-[1rem]">
            {t('pinnedMessages', 'Закреплённое сообщение')} #
            {!!currentMessageNumber && currentMessageNumber}
          </span>

          {(currentMessage.type === 'text' || currentMessage.content) && (
            <p className="pinned-messages__text">{currentMessage.content}</p>
          )}

          {currentMessage.type === 'image' && !currentMessage.content && (
            <p className="pinned-min-w-0 w-full truncate text-sm md:text-[1rem]">
              {currentMessage.mediaUrl}
            </p>
          )}

          {currentMessage.type === 'file' && !currentMessage.content && (
            <p className="pinned-min-w-0 w-full truncate text-sm md:text-[1rem]">
              {currentMessage.mediaEncryption.fileName}
            </p>
          )}
        </div>
      </button>
      <button
        className="rotate-45 cursor-pointer text-[rgba(255,255,255,0.95)]"
        onClick={() => setPinnedMessagesOpen(true)}
      >
        <Icon name="pin" />
      </button>
    </div>
  );
};
