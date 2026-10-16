import { Skeleton } from '@/shared/ui';
import { cn } from '@/shared/lib';
import { chatRowStyles } from '@/entities/chat';

const WIDTHS = [
  ['w-[44%]', 'w-[28%]'],
  ['w-[36%]', 'w-[22%]'],
  ['w-[50%]', 'w-[32%]'],
  ['w-[40%]', 'w-[24%]'],
];

export function CallHistorySkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => {
        const [nameWidth, statusWidth] = WIDTHS[index % WIDTHS.length];
        return (
          <div
            className={cn(chatRowStyles, 'pointer-events-none')}
            data-testid="call-history-skeleton"
            key={index}
          >
            <Skeleton className="size-11.5 shrink-0 rounded-pill" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className={cn('h-3 rounded-control', nameWidth)} />
                <Skeleton className="h-2.5 w-10 rounded-control" />
              </div>
              <Skeleton className={cn('h-2.5 rounded-control', statusWidth)} />
            </div>
            <Skeleton className="size-8 shrink-0 rounded-full" />
          </div>
        );
      })}
    </>
  );
}
