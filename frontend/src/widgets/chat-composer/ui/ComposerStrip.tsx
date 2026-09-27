import { Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import type { ReactNode } from 'react';

interface Props {
  icon: TIconTypes;
  title: ReactNode;
  text?: ReactNode;
  cancelLabel: string;
  onCancel: () => void;
}

/**
 * Полоска над полем ввода — ответ или правка, по макету (#821): иконка
 * 18 цветом акцента, под полосой 2px — заголовок и строка текста 13px,
 * справа отмена 32×32.
 */
export function ComposerStrip({ icon, title, text, cancelLabel, onCancel }: Props) {
  return (
    <div className="flex items-center gap-2.5 pt-2.5 pr-2 pb-0.5 pl-3.5">
      <Icon aria-hidden="true" className="size-4.5 shrink-0 text-brand" name={icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-px border-l-2 border-brand pl-2.5 text-caption">
        <span className="truncate font-semibold text-brand">{title}</span>
        {text && <span className="truncate text-ink-2">{text}</span>}
      </span>
      <button
        aria-label={cancelLabel}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-field text-ink-3 hover:layer-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
        onClick={onCancel}
        type="button"
      >
        <Icon className="size-4.25 stroke-2" name="cross" />
      </button>
    </div>
  );
}
