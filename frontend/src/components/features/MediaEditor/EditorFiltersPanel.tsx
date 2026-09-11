import { Button } from '@/shared/ui';
import type { IEditorFilter } from '@/types';
import { EditorRange, PanelTitle } from './EditorControls';

interface Props {
  filters: IEditorFilter;
  onUpdateFilter: (name: keyof IEditorFilter, value: number) => void;
  onCommitFilters: () => void;
  onResetFilters: () => void;
}

export function EditorFiltersPanel({
  filters,
  onUpdateFilter,
  onCommitFilters,
  onResetFilters,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <PanelTitle>Фильтры</PanelTitle>
        <Button onClick={onResetFilters} size="sm" variant="secondary">
          Сбросить
        </Button>
      </div>

      <EditorRange
        label="Яркость"
        max={200}
        min={0}
        onAfterChange={onCommitFilters}
        onChange={(value) => onUpdateFilter('brightness', value)}
        value={filters.brightness}
      />
      <EditorRange
        label="Контраст"
        max={200}
        min={0}
        onAfterChange={onCommitFilters}
        onChange={(value) => onUpdateFilter('contrast', value)}
        value={filters.contrast}
      />
      <EditorRange
        label="Насыщенность"
        max={200}
        min={0}
        onAfterChange={onCommitFilters}
        onChange={(value) => onUpdateFilter('saturate', value)}
        value={filters.saturate}
      />
      <EditorRange
        label="Сепия"
        max={100}
        min={0}
        onAfterChange={onCommitFilters}
        onChange={(value) => onUpdateFilter('sepia', value)}
        value={filters.sepia}
      />
      <EditorRange
        label="Размытие"
        max={20}
        min={0}
        onAfterChange={onCommitFilters}
        onChange={(value) => onUpdateFilter('blur', value)}
        suffix="px"
        value={filters.blur}
      />
    </div>
  );
}
