import { cn } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

interface Props {
  isChecked: boolean;
  className?: string;
}

/* Выбор сообщения — кружок 22 слева от строки, как в макете (#820):
   рамка ink-3, выбранный залит акцентом с белой галочкой. */
export function MessageCheckbox({ isChecked, className }: Props) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={cn(
        'flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-pill border-2 transition-colors duration-[140ms]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
        isChecked
          ? 'border-brand-fill bg-brand-fill text-on-brand'
          : 'border-ink-3 bg-transparent text-transparent',
        className
      )}
      aria-pressed={!!isChecked}
      aria-label={
        isChecked ? t('uncheckMessage', 'Снять выбор') : t('checkMessage', 'Выбрать сообщение')
      }
    >
      <Icon className="size-3.25 stroke-3" name="check" />
    </button>
  );
}
