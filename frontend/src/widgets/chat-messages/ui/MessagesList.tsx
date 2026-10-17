import { useFeedKeyboardNavigation } from '../model/useFeedKeyboardNavigation';
import { useVirtualMessagesFeed } from '../model/useVirtualMessagesFeed';
import type { IReadMark } from '../model/unread';
import { useJumpToMessage } from '@/features/jump-to-message';
import { useProfileStore } from '@/entities/user';
import { useChatUiStore } from '@/entities/chat';
import type { IMessageDto, TMessagesList } from '@/types';
import {
  memo,
  useCallback,
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MessageBubble, MessageBubbleSkeleton } from '@/entities/message';
import { cn } from '@/shared/lib';
import { DateDivider } from './DateDivider';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { ThreadState } from './ThreadState';
import { UnreadDivider } from './UnreadDivider';

interface Props {
  messages: TMessagesList;
  isLoading: boolean;
  error: string;
  setOpenedImage: Dispatch<SetStateAction<string | null>>;
  toggleMessageSelection: (message: IMessageDto) => void;
  /** Нажатие по реакции под сообщением: ставит свою или снимает. */
  onReact: (message: IMessageDto, emoji: string) => void;
  loadOlder?: () => Promise<void> | void;
  hasOlder?: boolean;
  messagesRef?: RefObject<HTMLElement | null>;
  bottomRef?: RefObject<HTMLDivElement | null>;
  /** Повторная отправка сообщения из Outbox при сбое сети (#552). */
  onRetryMessage?: (message: IMessageDto) => void;
  /** Отмена/удаление сообщения из Outbox (#552). */
  onCancelMessage?: (message: IMessageDto) => void;
  /** Профиль автора пересланного сообщения (#785). */
  onOpenProfile?: (userId: string) => void;
  /**
   * Показывать ли статус доставки у своих сообщений. Только личные чаты:
   * в группе у «прочитано» нет одного значения — непонятно, прочитал один
   * участник или все.
   */
  showDeliveryStatus?: boolean;
  /** Группа: у чужих сообщений имя и аватарка автора (#820). */
  isGroupChat?: boolean;
  /** «Новые сообщения» и счётчик на кнопке «вниз» — только в самом чате. */
  trackUnread?: boolean;
  /**
   * Выполнять запросы «перейти к сообщению» из других частей экрана
   * (#842). Только у ленты открытого чата, не у списка закреплённых.
   */
  handleJumpRequests?: boolean;
  /**
   * Отметка прочтения чата (#839): лента открывается на «Новые сообщения».
   * Нужна, когда `trackUnread`: без неё лента ждёт и не прокручивается.
   */
  readMark?: IReadMark;
  onMessagesSeen?: (messages: IMessageDto[]) => void;
  chatId?: string;
}

export const MessagesList = memo(
  ({
    messages,
    error,
    isLoading,
    setOpenedImage,
    toggleMessageSelection,
    onReact,
    loadOlder,
    hasOlder,
    bottomRef,
    messagesRef,
    onRetryMessage,
    onOpenProfile,
    onCancelMessage,
    showDeliveryStatus = false,
    isGroupChat = false,
    trackUnread = true,
    handleJumpRequests = false,
    readMark,
    onMessagesSeen,
    chatId,
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
      unreadBelow,
      scrollToBottom,
      jumpToMessage,
    } = useVirtualMessagesFeed({
      messages,
      messagesRef,
      currentUserId: user?.id,
      trackUnread,
      readMark,
      loadOlder,
      hasOlder,
      onMessagesSeen,
    });

    const scrollToFeedIndex = useCallback(
      (index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }),
      [virtualizer]
    );
    const { activeMessageId, handleFocus, handleKeyDown } = useFeedKeyboardNavigation({
      feedItems,
      scrollToIndex: scrollToFeedIndex,
    });
    const renderedMessageIds = virtualItems.flatMap(({ index }) =>
      feedItems[index]?.type === 'message' ? [feedItems[index].id] : []
    );
    const tabStopId =
      activeMessageId && renderedMessageIds.includes(activeMessageId)
        ? activeMessageId
        : renderedMessageIds.at(-1);

    // Чат ленты — по переданному пропу или сообщениям
    const activeChatId = chatId || messages.find((message) => message.chatId)?.chatId;
    const { jumpToMessage: handleJumpToMessage } = useJumpToMessage({
      onScrollToMessage: jumpToMessage,
      loadOlder,
      hasMoreOlder: hasOlder,
      chatId: activeChatId,
    });

    /* Переход, запрошенный из другой части экрана — из общего в профиле
       (#842) или закреплений. Запрос чужого чата не трогаем: его выполнит своя лента. */
    const jumpRequest = useChatUiStore((state) => state.jumpRequest);
    const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);
    useEffect(() => {
      if (!handleJumpRequests || !jumpRequest) return;
      if (jumpRequest.chatId && activeChatId && jumpRequest.chatId !== activeChatId) return;
      setJumpRequest(null);
      void handleJumpToMessage(jumpRequest.messageId);
    }, [handleJumpRequests, handleJumpToMessage, jumpRequest, setJumpRequest, activeChatId]);

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
          /* Поля ленты — по макету: 12 / 18 / 22 / 28 по бокам, 8 сверху
             и 12 снизу. */
          className="thread-messages styled-scrollbar relative flex-1 min-h-0 overflow-y-auto px-3 pt-2 pb-3 md:px-4.5 lg:px-5.5 xl:px-7"
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
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

                const replyId =
                  item.type === 'message'
                    ? item.message.replyTo || item.message.replyToMessageId
                    : null;

                return (
                  <div
                    className={cn(
                      'w-full absolute top-0 left-0',
                      item.type === 'message' && item.isDifferentAuthor && 'pt-2'
                    )}
                    data-index={virtualRow.index}
                    key={item.id}
                    ref={virtualizer.measureElement}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {item.type === 'date' ? (
                      <DateDivider label={item.label} variant="inline" />
                    ) : item.type === 'unread' ? (
                      <UnreadDivider />
                    ) : (
                      <MessageBubble
                        currentUserId={user.id}
                        isFirstInGroup={item.isFirstInGroup}
                        isGroupChat={isGroupChat}
                        isLastInGroup={item.isLastInGroup}
                        message={item.message}
                        onJumpToMessage={handleJumpToMessage}
                        onOpenProfile={onOpenProfile}
                        onOpenImage={setOpenedImage}
                        onReact={onReact}
                        onRetryMessage={onRetryMessage}
                        onCancelMessage={onCancelMessage}
                        onSelection={toggleMessageSelection}
                        repliedMessage={replyId ? messagesById.get(replyId) : undefined}
                        showDeliveryStatus={showDeliveryStatus}
                        tabIndex={item.id === tabStopId ? 0 : -1}
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

        <ScrollToBottomButton
          onClick={scrollToBottom}
          unread={unreadBelow}
          visible={showScrollBottom}
        />
      </div>
    );
  }
);

MessagesList.displayName = 'MessagesList';
