import type { PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  label: string;
  className?: string;
  width: number;
  min: number;
  max: number;
  onNudge: (delta: number) => void;
  onJump: (edge: 'min' | 'max') => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/** Шаг стрелкой. Крупнее пикселя: подпиксельная точность здесь ни к чему. */
const STEP = 16;

/**
 * Граница между колонками, за которую тянут.
 *
 * Клавиатура важна не меньше мыши: роль и границы у разделителя были и
 * раньше, но без фокуса и обработки стрелок он оставался украшением —
 * человек, который не пользуется мышью, ширину поменять не мог вовсе.
 *
 * Наружу уходит намерение — «шагнуть» или «к краю», — а не готовое
 * число: при удержании клавиши события идут чаще, чем React
 * перерисовывает, и компонент, считающий от отрисованной ширины, топтался
 * бы на одном шаге.
 *
 * `aria-valuenow` в пикселях, как `min` и `max`: доля от экрана менялась
 * бы при каждом изменении размера окна, и диктор объявлял бы новое
 * значение без действий человека.
 */
export function PaneResizer({
  label,
  className,
  width,
  min,
  max,
  onNudge,
  onJump,
  onPointerDown,
}: Props) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      className={className}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowLeft':
            event.preventDefault();
            onNudge(-STEP);
            break;
          case 'ArrowRight':
            event.preventDefault();
            onNudge(STEP);
            break;
          case 'Home':
            event.preventDefault();
            onJump('min');
            break;
          case 'End':
            event.preventDefault();
            onJump('max');
            break;
          default:
            break;
        }
      }}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
    />
  );
}
