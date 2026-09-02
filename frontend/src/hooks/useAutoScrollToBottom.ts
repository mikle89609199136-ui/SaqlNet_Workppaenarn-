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
  /* `anchorRef` в зависимостях, хотя ссылка стабильна: правило этого не
     знает — параметром может прийти что угодно, — а лишних прогонов от
     стабильной ссылки не будет. */
  useEffect(() => {
    scrollToBottomRef(anchorRef, 'auto');
  }, [anchorRef, chatId, isLoading]);
}
