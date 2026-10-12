import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import type { TFeedItem } from './useVirtualMessagesFeed';

const MESSAGE_SELECTOR = 'article[id]';

interface Params {
  feedItems: TFeedItem[];
  scrollToIndex: (index: number) => void;
}

function nextPosition(key: string, position: number, last: number): number | null {
  switch (key) {
    case 'ArrowUp':
      return Math.max(0, position - 1);
    case 'ArrowDown':
      return Math.min(last, position + 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

const messageTarget = (target: EventTarget) =>
  target instanceof HTMLElement && target.matches(MESSAGE_SELECTOR) ? target : null;

export function useFeedKeyboardNavigation({ feedItems, scrollToIndex }: Params) {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);

  const messageIndexes = useMemo(
    () => feedItems.flatMap((item, index) => (item.type === 'message' ? [index] : [])),
    [feedItems]
  );

  useLayoutEffect(() => {
    const id = pendingFocusRef.current;
    const element = id ? document.getElementById(id) : null;
    if (!element) return;
    pendingFocusRef.current = null;
    element.focus({ preventScroll: true });
  });

  const handleFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const message = messageTarget(event.target);
    if (message) setActiveMessageId(message.id);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const message = messageTarget(event.target);
      if (!message) return;

      const position = messageIndexes.findIndex((index) => feedItems[index].id === message.id);
      const next = nextPosition(event.key, position, messageIndexes.length - 1);
      if (position === -1 || next === null) return;

      event.preventDefault();
      if (next === position) return;

      const feedIndex = messageIndexes[next];
      const nextId = feedItems[feedIndex].id;
      pendingFocusRef.current = nextId;
      setActiveMessageId(nextId);
      scrollToIndex(feedIndex);
    },
    [feedItems, messageIndexes, scrollToIndex]
  );

  return { activeMessageId, handleFocus, handleKeyDown };
}
