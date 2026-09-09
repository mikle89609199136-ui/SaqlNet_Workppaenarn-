import { Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import type { ReactNode } from 'react';

interface Props {
  icon: TIconTypes;
  title: string;
  children: ReactNode;
}

/**
 * Экран раздела, которого ещё нет.
 *
 * Нужен, потому что молчание читается как поломка: до этого нажатие на
 * «Каналы» ловил общий перехват маршрутов и возвращал человека в чаты —
 * адрес менялся, экран оставался прежним, и выходило, будто кнопка
 * сломана. Раздел лучше скажет о себе сам.
 *
 * Значок берётся тот же, что у пункта в навигации: так видно, что попал
 * куда собирался, а не улетел неизвестно куда.
 */
export function SectionStub({ icon, title, children }: Props) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-pill bg-sheet-2 text-ink-3">
        <Icon name={icon} size="xl" />
      </span>
      <h1 className="text-section font-semibold text-ink">{title}</h1>
      <p className="max-w-[42ch] text-body text-ink-2">{children}</p>
    </main>
  );
}
