import { useVirtualMessagesFeed } from '@/hooks';
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
    bottomRef,
    messagesRef,
  }: Props) => {
    const { t } = useTranslation();
    const user = useProfileStore((state) => state.user);
    const translations = useChatUiStore((state) => state.translations);

    const {
      activeDate,
      feedItems,
      messagesById,
      virtualizer,
      virtualItems,
      setContainerRef,
      showScrollBottom,
      scrollToBottom,
    } = useVirtualMessagesFeed({ messages, messagesRef });

    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Плавающий разделитель даты поверх виртуализированного списка */}
        {activeDate && feedItems.length > 0 && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none transition-opacity duration-fast">
            <span className="px-3.5 py-1 rounded-pill bg-sheet-2/90 backdrop-blur-md border border-line-soft text-caption font-medium text-ink-3 shadow-xs">
              {activeDate}
            </span>
          </div>
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
                      <DateDivider label={item.label} />
                    ) : (
                      <MessageBubble
                        currentUserId={user.id}
                        message={item.message}
                        onOpenImage={setOpenedImage}
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
