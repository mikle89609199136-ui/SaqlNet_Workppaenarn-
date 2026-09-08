import { Icon, Slider } from '@/components/ui';
import { EDITOR_COLORS } from '@/consts';
import { cn } from '@/utils';
import type { ReactNode } from 'react';

interface PanelTitleProps {
  children: ReactNode;
  className?: string;
}

export function PanelTitle({ children, className }: PanelTitleProps) {
  return (
    <h3
      className={cn(
        'm-0 text-caption font-semibold uppercase tracking-wider text-ink-3',
        className
      )}
    >
      {children}
    </h3>
  );
}

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const isCustomColor = !EDITOR_COLORS.includes(color);

  return (
    <div className="flex flex-wrap items-center gap-2.5 p-1.5 overflow-visible">
      {EDITOR_COLORS.map((item) => {
        const isSelected = color === item;
        return (
          <button
            aria-label={item}
            className={cn(
              'relative w-8 h-8 rounded-full cursor-pointer transition-all duration-fast shrink-0 border border-line-soft shadow-sm focus-visible:outline-none',
              isSelected
                ? 'ring-2 ring-brand ring-offset-2 ring-offset-sheet-2'
                : 'hover:opacity-90 active:scale-95'
            )}
            key={item}
            onClick={() => onChange(item)}
            style={{ backgroundColor: item }}
            type="button"
          >
            {isSelected && (
              <span
                className={cn(
                  'absolute inset-0 m-auto w-2 h-2 rounded-full shadow-sm',
                  item === '#ffffff' ? 'bg-black' : 'bg-white'
                )}
              />
            )}
          </button>
        );
      })}

      <label
        aria-label="Выбрать цвет"
        className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded-full cursor-pointer transition-all duration-fast shrink-0 border border-line-soft shadow-sm overflow-hidden',
          isCustomColor
            ? 'ring-2 ring-brand ring-offset-2 ring-offset-sheet-2'
            : 'bg-sheet-2 hover:bg-sheet text-ink-2 hover:text-ink active:scale-95'
        )}
        style={isCustomColor ? { backgroundColor: color } : undefined}
        title="Выбрать цвет"
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
          aria-label="Выбрать цвет"
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
}

export function EditorRange({
  label,
  min,
  max,
  value,
  onChange,
  onAfterChange,
  suffix = '%',
}: EditorRangeProps) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between text-caption font-medium">
        <span className="text-ink-2">{label}</span>
        <strong className="text-brand font-semibold tabular-nums">
          {value}
          {suffix}
        </strong>
      </div>
      <Slider
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onAfterChange}
        onTouchEnd={onAfterChange}
        value={value}
      />
    </div>
  );
}
