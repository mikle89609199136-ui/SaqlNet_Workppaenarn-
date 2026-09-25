import { Skeleton } from '@/shared/ui';
import { cn } from '@/shared/lib';
import { chatRowStyles } from './chatRowStyles';

/* Лежит рядом с самой строкой намеренно. Скелетон обязан повторять её
   геометрию, а порознь они разъезжаются молча: прежний рисовал кружок в
   40 пикселей, тогда как строка перешла на 48, и список при загрузке
   дёргался. Здесь расхождение видно сразу — обе разметки на экране.

   Оформление берётся у самой строки, а не повторяется: разделитель между
   соседними строками держится на том, что класс у них общий. */
export function ChatListItemSkeleton({ rows = 8 }: { rows?: number }) {
  return Array.from({ length: rows }, (_, index) => (
    <div className={cn(chatRowStyles, 'pointer-events-none')} key={index}>
      <Skeleton className="size-12 rounded-pill" />
      <div className="flex min-w-0 flex-col justify-center gap-1.5">
        {/* Ширины разные, чтобы список не выглядел решёткой. */}
        <Skeleton className="h-3 w-[46%]" />
        <Skeleton className="h-2.5 w-[72%]" />
      </div>
    </div>
  ));
}
