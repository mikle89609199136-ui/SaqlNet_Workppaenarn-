import { cn } from '@/shared/lib';
import { forwardRef, useRef, type HTMLAttributes, type KeyboardEvent } from 'react';

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string; disabled?: boolean }[];
  /**
   * Вкладки вместо переключателя: разделы списка чатов (#818). Роли
   * tablist и tab, обход стрелками, подложка выбранной вкладки скользит.
   * Задаётся основой для id: вкладка получает `${tabs}-${value}`, панель
   * под ними — `${tabs}-panel`, и у панели есть чем назваться.
   */
  tabs?: string;
}

/* Вкладки списка по макету: 34px, 13px, выбранная — полужирная; подложка
   переезжает к выбранной за 280ms. Ширина вкладок равная, поэтому
   жирный текст выбранной не двигает соседей. */
const TAB_MOTION = 'transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]';

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl({ value, onChange, options, tabs, className, ...rest }, ref) {
    const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
    const activeIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value)
    );

    /* Вкладки обходятся стрелками, а табом в них попадают один раз — на
       выбранную (шаблон «tabs» из WAI-ARIA). Выбор следует за фокусом:
       переключение раздела ничего не ломает и не грузит тяжёлого. */
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      const enabled = options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => !option.disabled);
      const position = enabled.findIndex(({ index }) => index === activeIndex);
      let next: number | undefined;

      if (event.key === 'ArrowRight') next = enabled[(position + 1) % enabled.length]?.index;
      if (event.key === 'ArrowLeft')
        next = enabled[(position - 1 + enabled.length) % enabled.length]?.index;
      if (event.key === 'Home') next = enabled[0]?.index;
      if (event.key === 'End') next = enabled[enabled.length - 1]?.index;
      if (next === undefined) return;

      event.preventDefault();
      onChange(options[next].value);
      buttonsRef.current[next]?.focus();
    };

    return (
      <div
        ref={ref}
        /* Сегменты равной ширины (дизайн-система, #817): переключатель из
           двух-трёх вариантов читается как одно целое, а не как ряд кнопок
           по длине подписи. */
        className={cn(
          'inline-grid grid-flow-col auto-cols-fr rounded-button bg-sheet-2 p-1',
          tabs ? 'relative' : 'gap-1',
          className
        )}
        role={tabs ? 'tablist' : 'group'}
        {...rest}
      >
        {tabs && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-1 bottom-1 left-1 rounded-field bg-sheet shadow-[var(--shadow-tab)]',
              TAB_MOTION,
              'motion-reduce:transition-none'
            )}
            style={{
              width: `calc((100% - 8px) / ${options.length})`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />
        )}

        {options.map((opt, index) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              ref={(node) => {
                buttonsRef.current[index] = node;
              }}
              type="button"
              disabled={opt.disabled}
              data-state={isActive ? 'active' : 'inactive'}
              {...(tabs
                ? {
                    role: 'tab',
                    id: `${tabs}-${opt.value}`,
                    'aria-selected': isActive,
                    'aria-controls': `${tabs}-panel`,
                    tabIndex: isActive ? 0 : -1,
                    onKeyDown: handleKeyDown,
                  }
                : { 'aria-pressed': isActive })}
              onClick={() => onChange(opt.value)}
              className={cn(
                'rounded-field bg-transparent text-ink-2 cursor-pointer',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
                tabs
                  ? /* Подложку рисует общий бегунок, у вкладки — только текст. */
                    'relative h-8.5 px-2 text-caption font-normal transition-colors duration-[200ms] data-[state=active]:font-semibold data-[state=active]:text-ink'
                  : /* Вес у всех сегментов один, выбранный отличается фоном и
                       цветом: жирный текст шире, и полоса дёргалась бы при
                       каждом переключении. */
                    'h-9.5 px-3.5 text-ui font-semibold transition-all duration-fast data-[state=active]:bg-sheet data-[state=active]:text-ink data-[state=active]:shadow-[var(--shadow-tab)]'
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }
);
