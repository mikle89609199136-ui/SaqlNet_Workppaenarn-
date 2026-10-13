import { useChatUiStore } from '@/entities/chat';
import type { TPinnedList } from '@/types';
import { useRef, useState } from 'react';

const MAX_VISIBLE_SEGMENTS = 4;

export function usePinnedNavigator(messages: TPinnedList) {
  const trackRef = useRef<HTMLDivElement>(null);
  const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);

  const [currentPinnedMessageIndex, setCurrentPinnedMessageIndex] = useState<number | null>(null);

  /* Показывается последнее закрепление, и при изменении их числа выбор
     возвращается к нему же. Сравнением во время отрисовки, а не
     эффектом: эффект переставлял бы указатель после нарисованного кадра,
     и при откреплении плашка успевала показать чужое сообщение. */
  const [seenCount, setSeenCount] = useState(messages.length);

  if (messages.length !== seenCount) {
    setSeenCount(messages.length);
    setCurrentPinnedMessageIndex(messages.length ? messages.length - 1 : null);
  }

  const totalSegments = messages.length;
  const safeIndex = Math.min(
    currentPinnedMessageIndex ?? totalSegments - 1,
    Math.max(totalSegments - 1, 0)
  );
  const currentItem = messages[safeIndex];
  const currentMessage = currentItem?.message;

  const visibleSegments = Math.min(totalSegments, MAX_VISIBLE_SEGMENTS);
  const isFilling = totalSegments <= MAX_VISIBLE_SEGMENTS;
  const maxWindowStart = Math.max(totalSegments - visibleSegments, 0);
  const windowStart = Math.min(Math.max(safeIndex - visibleSegments + 1, 0), maxWindowStart);

  const handleClick = () => {
    if (!currentMessage) return;

    const chatId = currentItem.chatId || currentMessage.chatId;
    useChatUiStore.getState().setHighlightedMessageId(null);
    setJumpRequest({ chatId, messageId: currentMessage.id });

    if (safeIndex === 0 && trackRef.current) {
      trackRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = '';
      });
    }

    setCurrentPinnedMessageIndex((prev) => {
      const current = prev ?? messages.length - 1;
      return current === 0 ? messages.length - 1 : current - 1;
    });
  };

  const currentMessageNumber = safeIndex + 1;
  const senderTitle = currentMessage?.senderFirstName || currentMessage?.senderName || '';

  return {
    trackRef,
    safeIndex,
    currentMessage,
    totalSegments,
    visibleSegments,
    isFilling,
    windowStart,
    currentMessageNumber,
    senderTitle,
    handleClick,
  };
}
