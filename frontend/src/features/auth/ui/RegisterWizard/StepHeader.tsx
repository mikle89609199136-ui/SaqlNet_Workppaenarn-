import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';

interface Props {
  activeIndex: number;
  onBack: () => void;
  /** Заголовок шага и пояснение под ним. */
  title: string;
  subtitle: string;
}

/**
 * Шапка шагов — по макету (#827): «назад», точки хода и заголовок шага.
 * Логотип на этих экранах не нужен — человек уже внутри, ему важно видеть,
 * где он и как вернуться.
 */
export function StepHeader({ activeIndex, onBack, title, subtitle }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <div className="-mx-2 -mt-2 mb-5 flex items-center gap-3">
        <button
          aria-label={t('back', 'Назад')}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-icon text-ink-2 transition-colors duration-fast hover:layer-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          onClick={onBack}
          type="button"
        >
          <Icon className="size-5.5 stroke-2" name="chevronLeft" />
        </button>
        <div aria-hidden="true" className="flex flex-1 justify-center gap-2">
          {[0, 1].map((index) => (
            <span
              className={
                index === activeIndex
                  ? 'h-1.5 w-6 rounded-pill bg-brand-fill transition-[width,background-color] duration-[220ms]'
                  : 'h-1.5 w-1.5 rounded-pill bg-divider transition-[width,background-color] duration-[220ms]'
              }
              key={index}
            />
          ))}
        </div>
        {/* Уравновешивает кнопку слева, чтобы точки стояли по центру. */}
        <span className="w-10 shrink-0" />
      </div>
      <div className="mb-6 animate-fade-in text-center" key={title}>
        <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="m-0 mt-1.5 text-ui text-ink-2">{subtitle}</p>
      </div>
    </>
  );
}
