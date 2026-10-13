import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib';
import type { IEditorFilter } from '../model/types';
import { EditorChip, EditorRange } from './EditorControls';

interface Props {
  filters: IEditorFilter;
  onUpdateFilter: (name: keyof IEditorFilter, value: number) => void;
  onCommitFilters: () => void;
}

interface FilterOption {
  name: keyof IEditorFilter;
  label: string;
  max: number;
  /** Нейтральное значение посередине шкалы; у сепии и размытия нейтрально 0 — края нет. */
  neutral?: number;
  suffix?: string;
}

const FILTERS: FilterOption[] = [
  { name: 'brightness', label: 'Яркость', max: 200, neutral: 100 },
  { name: 'contrast', label: 'Контраст', max: 200, neutral: 100 },
  { name: 'saturate', label: 'Насыщенность', max: 200, neutral: 100 },
  { name: 'sepia', label: 'Сепия', max: 100 },
  { name: 'blur', label: 'Размытие', max: 20, suffix: 'px' },
];

/* На телефоне — чип параметра и один ползунок (две строки полки), на
   десктопе места хватает — все пять списком. Ползунки одни и те же:
   на телефоне невыбранные просто скрыты. «Сбросить» — в верхней строке. */
export function EditorFiltersPanel({ filters, onUpdateFilter, onCommitFilters }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<keyof IEditorFilter>('brightness');
  const labelOf = (filter: FilterOption) => t(`photoEditor.filters.${filter.name}`, filter.label);

  return (
    <div className="flex flex-col gap-2 md:gap-3">
      <div className="flex gap-2 -mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:hidden">
        {FILTERS.map((filter) => (
          <EditorChip
            active={active === filter.name}
            key={filter.name}
            onClick={() => setActive(filter.name)}
          >
            {labelOf(filter)}
          </EditorChip>
        ))}
      </div>

      {FILTERS.map((filter) => (
        <EditorRange
          className={cn(active !== filter.name && 'max-md:hidden')}
          key={filter.name}
          label={labelOf(filter)}
          max={filter.max}
          min={0}
          neutral={filter.neutral}
          onAfterChange={onCommitFilters}
          onChange={(value) => onUpdateFilter(filter.name, value)}
          suffix={filter.suffix}
          value={filters[filter.name]}
        />
      ))}
    </div>
  );
}
