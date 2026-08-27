import { useEffect, type DependencyList, type RefObject } from 'react';

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
  deps: DependencyList
) {
  useEffect(() => {
    scrollToBottomRef(anchorRef, 'auto');
  }, deps);
}
