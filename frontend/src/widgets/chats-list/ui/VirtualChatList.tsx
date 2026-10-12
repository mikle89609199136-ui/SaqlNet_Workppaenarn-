import type { IChatDto } from '@/types';
import type { ReactNode, RefObject } from 'react';
import { useVirtualChatRows } from '../model/useVirtualChatRows';

interface Props {
  chats: IChatDto[];
  scrollRef: RefObject<HTMLElement | null>;
  renderRow: (chat: IChatDto) => ReactNode;
}

export function VirtualChatList({ chats, scrollRef, renderRow }: Props) {
  const { listRef, measureRow, rows, totalHeight } = useVirtualChatRows({ chats, scrollRef });

  return (
    <div className="relative w-full shrink-0" ref={listRef} style={{ height: totalHeight }}>
      {rows.map(({ key, index, chat, offset }) => (
        <div
          className="absolute top-0 left-0 w-full pb-0.5"
          data-index={index}
          key={key}
          ref={measureRow}
          style={{ transform: `translateY(${offset}px)` }}
        >
          {renderRow(chat)}
        </div>
      ))}
    </div>
  );
}
