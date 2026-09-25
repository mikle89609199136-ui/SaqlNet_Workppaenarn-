import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';

interface Props {
  activeIndex: number;
  onBack: () => void;
}

/**
 * Шапка шагов: возврат назад и точки хода. Логотип на этих экранах не
 * нужен — человек уже внутри, ему важно видеть, где он и как вернуться.
 */
export function StepHeader({ activeIndex, onBack }: Props) {
  const { t } = useTranslation();

  return (
    <div className="mb-5 flex items-center gap-3">
      <button
        aria-label={t('back', 'Назад')}
        className="-ml-2 rounded-control p-1.5 text-ink-2 transition-colors duration-fast hover:bg-sheet-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        onClick={onBack}
        type="button"
      >
        <Icon className="rotate-180" name="chevronRight" size="md" />
      </button>
      <div className="flex flex-1 justify-center gap-2" aria-hidden>
        {[0, 1].map((index) => (
          <span
            className={
              index === activeIndex
                ? 'h-1.5 w-6 rounded-pill bg-brand'
                : 'h-1.5 w-1.5 rounded-pill bg-line'
            }
            key={index}
          />
        ))}
      </div>
      {/* Уравновешивает кнопку слева, чтобы точки стояли по центру. */}
      <span className="w-8" />
    </div>
  );
}
