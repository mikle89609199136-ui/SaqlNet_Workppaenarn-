import type { IChatDto } from '@/types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

const CHAT_ROW_ESTIMATE_PX = 66;
const OVERSCAN = 8;

interface Params {
  chats: IChatDto[];
  scrollRef: RefObject<HTMLElement | null>;
}

function useOffsetInScroll(listElement: HTMLElement | null) {
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    if (!listElement) return undefined;

    const measure = () => setOffset(listElement.offsetTop);
    measure();

    const observer = new ResizeObserver(measure);
    for (let node = listElement.previousElementSibling; node; node = node.previousElementSibling) {
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [listElement]);

  return offset;
}

export function useVirtualChatRows({ chats, scrollRef }: Params) {
  const [listElement, setListElement] = useState<HTMLElement | null>(null);
  const scrollMargin = useOffsetInScroll(listElement);

  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAT_ROW_ESTIMATE_PX,
    getItemKey: useCallback((index: number) => chats[index]?.id ?? index, [chats]),
    overscan: OVERSCAN,
    scrollMargin,
    useFlushSync: false,
  });

  const rows = virtualizer.getVirtualItems().map((row) => ({
    key: row.key,
    index: row.index,
    chat: chats[row.index],
    offset: row.start - scrollMargin,
  }));

  return {
    listRef: setListElement,
    measureRow: virtualizer.measureElement,
    rows,
    totalHeight: virtualizer.getTotalSize(),
  };
}
