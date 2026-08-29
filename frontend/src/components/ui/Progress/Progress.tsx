import { cn } from '@/utils';

interface Props {
  /**
   * Доля выполненного, от 0 до 1. Не передана — доля неизвестна, и полоса
   * бежит. Это разные состояния, а не «ноль»: у неизвестной доли нельзя
   * объявлять проценты, иначе диктор прочитает выдуманное число.
   */
  value?: number;
  /* Чем занята полоса: «Загрузка вложения», «Экспорт данных». */
  label: string;
  className?: string;
}

export function Progress({ className, label, value }: Props) {
  const isKnown = typeof value === 'number';
  const percent = isKnown ? Math.round(Math.min(Math.max(value, 0), 1) * 100) : undefined;

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-sheet-2', className)}
      role="progressbar"
    >
      <div
        className={cn(
          'h-full rounded-pill bg-brand-fill',
          isKnown
            ? 'transition-[width] duration-panel'
            : /* Бегущий отрезок замирает у тех, кто просил меньше движения:
                 для них полоса остаётся видимой, но перестаёт ездить. */
              'w-[38%] animate-[progress-crawl_1.2s_ease-in-out_infinite] motion-reduce:animate-none'
        )}
        /* Ширина — вычисляемое значение, ровно тот случай, для которого
           style и оставлен. */
        style={isKnown ? { width: `${percent}%` } : undefined}
      />
    </div>
  );
}
