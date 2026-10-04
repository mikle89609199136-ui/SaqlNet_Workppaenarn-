import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Slider } from '@/shared/ui/Slider';
import { formatVolume } from '@/shared/lib';
import type { ChangeEventHandler, MouseEvent } from 'react';

interface Props {
  value: number;
  toggleLabel: string;
  sliderLabel: string;
  onToggle: () => void;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

const stopPropagation = (event: MouseEvent) => event.stopPropagation();

export function VolumePopover({ value, toggleLabel, sliderLabel, onToggle, onChange }: Props) {
  return (
    <div className="group/vol relative shrink-0">
      <Button
        aria-label={toggleLabel}
        className="shrink-0"
        iconOnly
        onClick={(event) => {
          stopPropagation(event);
          onToggle();
        }}
        size="sm"
        variant="ghost"
      >
        <Icon className="h-5 w-5" name={value === 0 ? 'volumeMute' : 'volume'} />
      </Button>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 opacity-0 transition-opacity group-hover/vol:pointer-events-auto group-hover/vol:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
        <div className="mb-1 flex h-28 w-10 items-center justify-center rounded-field border border-line bg-sheet shadow-[var(--elev-3)]">
          <div className="flex h-20 w-4 items-center justify-center">
            <Slider
              aria-label={sliderLabel}
              className="w-20 shrink-0 origin-center -rotate-90"
              max={1}
              min={0}
              onChange={onChange}
              onClick={stopPropagation}
              step={0.05}
              value={value}
              valueText={formatVolume(value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
