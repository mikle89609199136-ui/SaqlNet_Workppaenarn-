import { useTranslation } from 'react-i18next';
import { Icon, Slider } from '@/shared/ui';
import { EDITOR_COLORS } from '../model/config';
import { cn } from '@/shared/lib';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface PanelTitleProps {
  children: ReactNode;
  className?: string;
}

/* Заголовок группы в колонке десктопа. На телефоне скрыт: в полке две
   строки, и цвета, кисти, шрифты узнаются без подписи. */
export function PanelTitle({ children, className }: PanelTitleProps) {
  return (
    <h3 className={cn('m-0 mb-2 text-caption font-medium text-ink-3 max-md:hidden', className)}>
      {children}
    </h3>
  );
}

interface EditorChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Не задан — чип-действие («+ Текст»), а не выбор: без aria-pressed. */
  active?: boolean;
}

/* Выбор из нескольких: пропорция, шрифт, параметр фильтра. Выбранный —
   светлая таблетка, как в макете A+; остальные на ступень светлее полки,
   чтобы читались как кнопки, а не как текст. */
export function EditorChip({ active, className, children, ...rest }: EditorChipProps) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'inline-flex h-8.5 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-pill bg-sheet-2 px-3.5 text-ui font-medium text-ink',
        'transition-colors duration-fast not-aria-pressed:hover:layer-hover',
        'aria-pressed:bg-ink aria-pressed:text-sheet',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
        className
      )}
      type="button"
      {...rest}
    >
      {children}
    </button>
  );
}

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const { t } = useTranslation();
  const pickColor = t('photoEditor.pickColor', 'Выбрать цвет');
  const isCustomColor = !EDITOR_COLORS.includes(color);

  return (
    // На телефоне кружки — одной строкой по ширине полки: перенос на вторую
    // строку съел бы место у остальных настроек.
    <div className="flex flex-wrap max-md:flex-nowrap max-md:justify-between items-center gap-2.5 max-md:gap-1 p-1.5 overflow-visible">
      {EDITOR_COLORS.map((item) => {
        const isSelected = color === item;
        return (
          <button
            aria-label={item}
            aria-pressed={isSelected}
            className={cn(
              'relative w-8 h-8 rounded-full cursor-pointer transition-all duration-fast shrink-0 border border-line-soft shadow-sm focus-visible:outline-none',
              isSelected
                ? 'ring-2 ring-ink ring-offset-2 ring-offset-sheet'
                : 'hover:opacity-90 active:scale-95'
            )}
            key={item}
            onClick={() => onChange(item)}
            style={{ backgroundColor: item }}
            type="button"
          />
        );
      })}

      <label
        aria-label={pickColor}
        className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded-full cursor-pointer transition-all duration-fast shrink-0 border border-line-soft shadow-sm overflow-hidden',
          isCustomColor
            ? 'ring-2 ring-ink ring-offset-2 ring-offset-sheet'
            : 'bg-sheet-2 hover:bg-sheet text-ink-2 hover:text-ink active:scale-95'
        )}
        style={isCustomColor ? { backgroundColor: color } : undefined}
        title={pickColor}
      >
        <Icon
          className={cn(
            'size-3.5 pointer-events-none relative z-10',
            isCustomColor ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]' : 'text-ink-2'
          )}
          name="pipette"
          size="sm"
        />
        <input
          aria-label={pickColor}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={color}
        />
      </label>
    </div>
  );
}

interface EditorRangeProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  onAfterChange?: () => void;
  suffix?: string;
  /**
   * Значение «без изменений». Если задано, на дорожке метка нуля, а число
   * показывается сдвигом от него со знаком: яркость 112% — это «+12».
   */
  neutral?: number;
  className?: string;
}

export function EditorRange({
  label,
  min,
  max,
  value,
  onChange,
  onAfterChange,
  suffix = '%',
  neutral,
  className,
}: EditorRangeProps) {
  const shift = neutral === undefined ? null : value - neutral;
  const shown = shift === null ? `${value}${suffix}` : `${shift > 0 ? '+' : ''}${shift}`;
  const zeroAt = neutral === undefined ? null : ((neutral - min) / (max - min)) * 100;
  const inputRef = useRef<HTMLInputElement>(null);

  /* Конец изменения — нативный change, а не pointerup + touchend:
     - на телефоне срабатывали оба, и один жест писал в историю два
       одинаковых шага — «Отменить» приходилось жать дважды;
     - со стрелок клавиатуры не приходил ни тот, ни другой, и правка
       не попадала в историю вовсе;
     - обработчик получал событие и передавал его дальше: commit(patch)
       принимал его за изменения состояния, и копирование истории падало
       на циклической ссылке DOM-узла — приложение целиком показывало
       «Unexpected Application Error».
     change браузер шлёт один раз, когда палец или мышь отпущены, и на
     каждый шаг с клавиатуры — и только если значение изменилось. */
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !onAfterChange) return undefined;
    const handleChange = () => onAfterChange();
    input.addEventListener('change', handleChange);
    return () => input.removeEventListener('change', handleChange);
  }, [onAfterChange]);

  return (
    <div className={cn('flex flex-col gap-1.5 py-1', className)}>
      <div className="flex items-center justify-between text-caption font-medium">
        <span className="text-ink-2">{label}</span>
        <strong className="text-ink font-semibold tabular-nums">{shown}</strong>
      </div>
      <div className="relative">
        {zeroAt !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-ink-3"
            style={{ left: `${zeroAt}%` }}
          />
        )}
        <Slider
          aria-label={label}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          ref={inputRef}
          value={value}
          valueText={shown}
        />
      </div>
    </div>
  );
}
