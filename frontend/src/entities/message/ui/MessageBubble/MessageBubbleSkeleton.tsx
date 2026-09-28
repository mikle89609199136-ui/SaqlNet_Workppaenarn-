import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/shared/lib';

/* Скелетон ленты — по макету (#820): пузыри со скруглением 16 по обе
   стороны, разной длины и высоты — в одну и в две строки.

   Чередование сторон и длин задано, а не случайно: со случайным список
   перерисовывается по-разному на каждый кадр загрузки и мельтешит. */
const rows = [
  { side: 'in', size: 'w-55 h-10' },
  { side: 'in', size: 'w-75 h-15.5' },
  { side: 'out', size: 'w-65 h-10' },
  { side: 'in', size: 'w-45 h-10' },
  { side: 'out', size: 'w-80 h-15.5' },
  { side: 'out', size: 'w-35 h-10' },
] as const;

export function MessageBubbleSkeleton({ count = rows.length }: { count?: number }) {
  return (
    <div className="flex flex-col">
      {rows.slice(0, count).map((row, index) => (
        <Skeleton
          className={cn(
            'mt-2 max-w-[80%] rounded-bubble',
            row.size,
            row.side === 'out' ? 'self-end' : 'self-start'
          )}
          key={index}
        />
      ))}
    </div>
  );
}
