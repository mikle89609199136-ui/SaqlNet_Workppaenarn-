import { useJumpToMessage, useVirtualMessagesFeed } from '@/hooks';
import { useChatUiStore, useProfileStore } from '@/store';
import type { IMessageDto, TMessagesList } from '@/types';
import { memo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import { MessageBubbleSkeleton } from '../MessageBubble/MessageBubbleSkeleton';
import { DateDivider } from './DateDivider';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { ThreadState } from './ThreadState';

interface Props {
  messages: TMessagesList;
  isLoading: boolean;
  error: string;
  setOpenedImage: Dispatch<SetStateAction<string | null>>;
  toggleMessageSelection: (message: IMessageDto) => void;
  /** Нажатие по реакции под сообщением: ставит свою или снимает. */
  onReact: (message: IMessageDto, emoji: string) => void;
  /** Переход к цитируемому сообщению (#553). */
  onJumpToMessage?: (messageId: string) => void;
  messagesRef?: RefObject<HTMLElement | null>;
  bottomRef?: RefObject<HTMLDivElement | null>;
}

export const MessagesList = memo(
  ({
    messages,
    error,
    isLoading,
    setOpenedImage,
    toggleMessageSelection,
    onReact,
    onJumpToMessage,
    bottomRef,
    messagesRef,
  }: Props) => {
    const { t } = useTranslation();
    const user = useProfileStore((state) => state.user);
    const translations = useChatUiStore((state) => state.translations);

    const {
      activeDate,
      isStickyVisible,
      stickyPushOffset,
      scrollPaddingRight,
      feedItems,
      messagesById,
      virtualizer,
      virtualItems,
      setContainerRef,
      showScrollBottom,
      scrollToBottom,
      jumpToMessage,
    } = useVirtualMessagesFeed({ messages, messagesRef });

    const { jumpToMessage: defaultJumpToMessage } = useJumpToMessage({
      onScrollToMessage: jumpToMessage,
    });

    const handleJumpToMessage = onJumpToMessage ?? defaultJumpToMessage;

    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Липкий разделитель даты в стиле Telegram с выталкиванием, затуханием и компенсацией скроллбара */}
        {activeDate && feedItems.length > 0 && (
          <DateDivider
            label={activeDate}
            paddingRight={scrollPaddingRight}
            pushOffset={stickyPushOffset}
            variant="sticky"
            visible={isStickyVisible}
          />
        )}
        <section
          aria-busy={isLoading}
          className="thread-messages styled-scrollbar relative flex-1 min-h-0 overflow-y-auto"
          ref={setContainerRef}
        >
          {isLoading && <MessageBubbleSkeleton />}
          {!isLoading && error && messages.length === 0 && (
            <ThreadState message={error} title={t('loadingError', 'Ошибка загрузки')} />
          )}
          {!isLoading && !error && messages.length === 0 && (
            <ThreadState
              message={t('emptyThreadDescription', 'Напишите первое сообщение в этом чате.')}
              title={t('emptyThread', 'Сообщений пока нет')}
            />
          )}

          {user && feedItems.length > 0 && (
            <div
              className="w-full relative"
              style={{
                height: `${virtualizer.getTotalSize()}px`,
              }}
            >
              {virtualItems.map((virtualRow) => {
                const item = feedItems[virtualRow.index];
                if (!item) return null;

                return (
                  <div
                    className="w-full absolute top-0 left-0"
                    data-index={virtualRow.index}
                    key={item.id}
                    ref={virtualizer.measureElement}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {item.type === 'date' ? (
                      <DateDivider label={item.label} variant="inline" />
                    ) : (
                      <MessageBubble
                        currentUserId={user.id}
                        message={item.message}
                        onJumpToMessage={handleJumpToMessage}
                        onOpenImage={setOpenedImage}
                        onReact={onReact}
                        onSelection={toggleMessageSelection}
                        repliedMessage={
                          item.message.replyTo ? messagesById.get(item.message.replyTo) : undefined
                        }
                        translations={translations}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div ref={bottomRef} />
        </section>

        <ScrollToBottomButton onClick={scrollToBottom} visible={showScrollBottom} />
      </div>
    );
  }
);

MessagesList.displayName = 'MessagesList';
