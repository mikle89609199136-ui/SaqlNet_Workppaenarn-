import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/shared/lib';

/* Форма повторяет настоящий пузырь, включая срезанный угол с той стороны,
   откуда пришло сообщение: у своих он снизу справа, у чужих снизу слева.
   Прямоугольник вместо этого читался бы как «что-то грузится», а не как
   «сейчас здесь будет переписка».

   Скруглением занимаемся сами, а не заимствуем .message-bubble: тот класс
   уезжает в разметку по #360, и скелетон уехал бы вместе с ним. Радиус
   при этом берётся из того же токена, так что форма не разойдётся. */
const shapes = {
  in: 'rounded-[var(--radius-bubble)_var(--radius-bubble)_var(--radius-bubble)_5px]',
  out: 'self-end mr-2.5 rounded-[var(--radius-bubble)_var(--radius-bubble)_5px_var(--radius-bubble)]',
} as const;

/* Чередование сторон и длин задано, а не случайно: со случайным список
   перерисовывается по-разному на каждый кадр загрузки и мельтешит. */
const rows = [
  { side: 'in', width: 'w-[62%]' },
  { side: 'out', width: 'w-[44%]' },
  { side: 'in', width: 'w-[54%]' },
  { side: 'out', width: 'w-[38%]' },
] as const;

export function MessageBubbleSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {rows.slice(0, count).map((row, index) => (
        <Skeleton className={cn('h-8', row.width, shapes[row.side])} key={index} />
      ))}
    </div>
  );
}
