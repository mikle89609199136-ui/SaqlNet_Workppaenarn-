import { Skeleton } from '@/shared/ui';
import { cn } from '@/shared/lib';
import { chatRowStyles } from './chatRowStyles';

/* Лежит рядом с самой строкой намеренно. Скелетон обязан повторять её
   геометрию, а порознь они разъезжаются молча: прежний рисовал кружок в
   40 пикселей, тогда как строка перешла на 48, и список при загрузке
   дёргался. Здесь расхождение видно сразу — обе разметки на экране.

   По макету (#819): кружок 46, две полоски 12 и 10 пикселей через 8.
   Ширины разные, чтобы список не выглядел решёткой. */
const WIDTHS = [
  ['w-[46%]', 'w-[72%]'],
  ['w-[38%]', 'w-[64%]'],
  ['w-[52%]', 'w-[80%]'],
  ['w-[42%]', 'w-[58%]'],
];

export function ChatListItemSkeleton({ rows = 8 }: { rows?: number }) {
  return Array.from({ length: rows }, (_, index) => {
    const [name, preview] = WIDTHS[index % WIDTHS.length];
    return (
      <div
        className={cn(chatRowStyles, 'pointer-events-none')}
        data-testid="chat-row-skeleton"
        key={index}
      >
        <Skeleton className="size-11.5 shrink-0 rounded-pill" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className={cn('h-3 rounded-control', name)} />
          <Skeleton className={cn('h-2.5 rounded-control', preview)} />
        </div>
      </div>
    );
  });
}
