import { cn } from '@/shared/lib';
import type { ReactNode } from 'react';

/* Приглушённый — для чатов с выключенным звуком. Оттенок живёт здесь, а
   не на экранах: иначе в одном месте такой чат станет серым, в другом
   получит иконку, в третьем не изменится вовсе. */
const tones = {
  brand: 'bg-brand-fill text-on-brand',
  quiet: 'bg-sheet-2 text-ink-2',
} as const;

interface Props {
  children: ReactNode;
  tone?: keyof typeof tones;
  /* Больше этого числа показывается как «99+». */
  max?: number;
  /* Что содержимое значит: «12 непрочитанных». Рядом с именем чата
     голое «12» диктор так и прочитает — «двенадцать», — и чего именно
     двенадцать, слушатель не узнает. Подпись уходит текстом, а не
     атрибутом: у обычного span aria-label до многих дикторов не
     доходит. */
  label?: string;
  className?: string;
}

export const Badge = ({ children, tone = 'brand', max = 99, label, className }: Props) => {
  const shown = typeof children === 'number' && children > max ? `${max}+` : children;

  return (
    <span
      className={cn(
        /* Моноширинный и tabular-nums, иначе счётчик дёргается вбок при
           смене 9 на 10. min-w — чтобы единица не была узким овалом.

           shrink-0 — потому что счётчик всегда стоит рядом с текстом,
           который длиннее его: в строке чата это последнее сообщение. Без
           запрета на сжатие флекс отдаёт место тексту, и «99+» показывается
           обрубком — замерено 22 пикселя вместо нужных 29. Сжиматься должен
           текст, у него для этого есть многоточие. */
        'inline-flex min-w-5 shrink-0 items-center justify-center rounded-pill px-2 py-0.5',
        'font-mono text-micro font-medium tabular-nums',
        tones[tone],
        className
      )}
    >
      <span aria-hidden={label ? 'true' : undefined}>{shown}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
};
