import { cn } from '@/utils';
import { useTranslation } from 'react-i18next';

const Check = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('opacity-90', className)}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
};

interface Props {
  isChecked: boolean;
  className?: string;
}

export function MessageCheckbox({ isChecked, className }: Props) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={cn(
        'size-6 flex items-center justify-center shrink-0 rounded-full border-2 transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        isChecked
          ? 'border-brand-fill bg-brand-fill text-on-brand'
          : 'border-line bg-sheet-2 text-transparent hover:border-ink-3',
        className
      )}
      aria-pressed={!!isChecked}
      aria-label={
        isChecked ? t('uncheckMessage', 'Снять выбор') : t('checkMessage', 'Выбрать сообщение')
      }
    >
      <Check
        className={cn(
          'size-3.5 transition-opacity',
          isChecked ? 'opacity-100 text-on-brand' : 'opacity-0'
        )}
      />
    </button>
  );
}
