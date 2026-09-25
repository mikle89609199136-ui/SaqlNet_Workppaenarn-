import { Button, Icon } from '@/shared/ui';
import { EDITOR_BRUSHES } from '@/shared/config';
import type { TBrushType } from '@/shared/types';
import { ColorPicker, EditorRange, PanelTitle } from './EditorControls';

interface Props {
  brushColor: string;
  brushType: TBrushType;
  brushSize: number;
  onColorChange: (color: string) => void;
  onBrushTypeChange: (brush: TBrushType) => void;
  onBrushSizeChange: (size: number) => void;
}

export function EditorDrawPanel({
  brushColor,
  brushType,
  brushSize,
  onColorChange,
  onBrushTypeChange,
  onBrushSizeChange,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <PanelTitle className="mb-2">Цвет</PanelTitle>
        <ColorPicker color={brushColor} onChange={onColorChange} />
      </div>

      <div>
        <PanelTitle className="mb-2">Тип кисти</PanelTitle>
        <div className="flex flex-wrap gap-2.5">
          {EDITOR_BRUSHES.map((brush) => (
            <Button
              className="w-11 h-11 p-0 flex items-center justify-center rounded-control"
              key={brush.id}
              onClick={() => onBrushTypeChange(brush.id)}
              title={brush.label}
              variant={brushType === brush.id ? 'primary' : 'secondary'}
            >
              <Icon name={brush.icon} size="md" />
            </Button>
          ))}
        </div>
      </div>

      <div>
        <EditorRange
          label="Размер кисти"
          max={80}
          min={1}
          onChange={onBrushSizeChange}
          suffix=""
          value={brushSize}
        />
      </div>
    </div>
  );
}
