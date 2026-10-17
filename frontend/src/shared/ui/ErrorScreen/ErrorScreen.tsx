import type { ReactNode } from 'react';
import type { TIconTypes } from '@/types';
import { cn } from '@/shared/lib';
import { Icon } from '../Icon';

interface Props {
  icon: TIconTypes;
  title: string;
  text?: string;
  /** Кнопки: «Перезагрузить», «Назад», «К списку чатов» — решает тот, кто показывает. */
  actions: ReactNode;
  /** Предупреждение, а не поломка — без сети значок другого цвета. */
  tone?: 'neutral' | 'warn';
  className?: string;
}

/**
 * Экран вместо того, что не смогло отрисоваться (#1071).
 *
 * Только вид: о роутере, запросах и переводах не знает — тексты и кнопки
 * приходят готовыми. Прежде на этом месте был английский стандартный
 * экран React Router без единой кнопки.
 */
export function ErrorScreen({ icon, title, text, actions, tone = 'neutral', className }: Props) {
  return (
    <div className={cn('flex flex-col items-center gap-3 text-center', className)} role="alert">
      <Icon
        aria-hidden="true"
        className={cn('size-10', tone === 'warn' ? 'text-warn' : 'text-ink-3')}
        name={icon}
      />
      <h2 className="text-section font-semibold text-ink">{title}</h2>
      {text && <p className="max-w-80 text-body text-ink-2">{text}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  );
}
