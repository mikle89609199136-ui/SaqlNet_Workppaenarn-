import { Skeleton } from '@/shared/ui';

/* Лежит рядом с самой строкой намеренно. Скелетон обязан повторять её
   геометрию, а порознь они разъезжаются молча: прежний рисовал кружок в
   40 пикселей, тогда как строка перешла на 48, и список при загрузке
   дёргался. Здесь расхождение видно сразу — обе разметки на экране. */
export function ChatListItemSkeleton({ rows = 8 }: { rows?: number }) {
  return Array.from({ length: rows }, (_, index) => (
    <div className="chat-row pointer-events-none" key={index}>
      <Skeleton className="size-12 rounded-pill" />
      <div className="chat-main">
        {/* Ширины разные, чтобы список не выглядел решёткой. */}
        <Skeleton className="h-3 w-[46%]" />
        <Skeleton className="h-2.5 w-[72%]" />
      </div>
    </div>
  ));
}
