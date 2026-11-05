import { useChatUiStore } from '@/entities/chat';
import type { TPinnedList } from '@/types';
import { useEffect, useRef, useState } from 'react';

const MAX_VISIBLE_SEGMENTS = 4;

export function usePinnedNavigator(messages: TPinnedList) {
  const trackRef = useRef<HTMLDivElement>(null);
  const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);
  const activePinnedId = useChatUiStore((state) => state.activePinnedId);
  const setActivePinnedId = useChatUiStore((state) => state.setActivePinnedId);
  const setPinnedNavLockUntil = useChatUiStore((state) => state.setPinnedNavLockUntil);

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

  /* Синхронизация с активным закреплением из стора ленты (скролл истории переписки, #1057) */
  const prevActivePinnedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activePinnedId || messages.length === 0) return;
    if (activePinnedId === prevActivePinnedIdRef.current) return;
    prevActivePinnedIdRef.current = activePinnedId;

    const targetIndex = messages.findIndex(
      (item) => item.messageId === activePinnedId || item.message?.id === activePinnedId
    );
    if (targetIndex !== -1) {
      setCurrentPinnedMessageIndex(targetIndex);
    }
  }, [activePinnedId, messages]);

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
    setJumpRequest({ chatId, messageId: currentMessage.id });

    if (safeIndex === 0 && trackRef.current) {
      trackRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = '';
      });
    }

    const nextIndex = safeIndex === 0 ? messages.length - 1 : safeIndex - 1;

    // Временная блокировка скролл-трекера на время плавной анимации прокрутки к сообщению (#1057)
    setPinnedNavLockUntil(Date.now() + 700);

    const nextItem = messages[nextIndex];
    const nextId = nextItem ? nextItem.messageId || nextItem.message?.id : null;
    if (nextId) {
      prevActivePinnedIdRef.current = nextId;
      setActivePinnedId(nextId);
    }

    setCurrentPinnedMessageIndex(nextIndex);
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
