import { useEffect, type RefObject } from 'react';

export function scrollToBottomRef(
  anchorRef: RefObject<HTMLDivElement | null>,
  behavior: ScrollBehavior = 'auto'
) {
  requestAnimationFrame(() => {
    anchorRef.current?.scrollIntoView({ block: 'end', behavior });
  });
}

export function useAutoScrollToBottom(
  anchorRef: RefObject<HTMLDivElement | null>,
  chatId: string,
  isLoading: boolean
) {
  useEffect(() => {
    scrollToBottomRef(anchorRef, 'auto');
  }, [chatId, isLoading]);
}
