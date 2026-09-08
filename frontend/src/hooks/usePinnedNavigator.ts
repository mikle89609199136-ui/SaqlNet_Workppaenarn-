import { useChatUiStore } from '@/store';
import type { TPinnedList } from '@/types';
import { useEffect, useRef, useState } from 'react';

const MAX_VISIBLE_SEGMENTS = 4;
const HIGHLIGHT_DURATION_MS = 1500;

export function usePinnedNavigator(messages: TPinnedList) {
  const trackRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setHighlightedMessageId = useChatUiStore((state) => state.setHighlightedMessageId);

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

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const totalSegments = messages.length;
  const safeIndex = Math.min(
    currentPinnedMessageIndex ?? totalSegments - 1,
    Math.max(totalSegments - 1, 0)
  );
  const currentMessage = messages[safeIndex]?.message;

  const visibleSegments = Math.min(totalSegments, MAX_VISIBLE_SEGMENTS);
  const isFilling = totalSegments <= MAX_VISIBLE_SEGMENTS;
  const maxWindowStart = Math.max(totalSegments - visibleSegments, 0);
  const windowStart = Math.min(Math.max(safeIndex - visibleSegments + 1, 0), maxWindowStart);

  const handleClick = () => {
    if (!currentMessage) return;

    requestAnimationFrame(() => {
      const el = document.getElementById(currentMessage.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    setHighlightedMessageId(currentMessage.id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
    }, HIGHLIGHT_DURATION_MS);

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
