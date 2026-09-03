import { Button, Icon } from '@/components/ui';
import { EDITOR_RATIOS } from '@/consts';
import type { TCropRatioValue } from '@/types';
import { PanelTitle } from './EditorControls';

interface Props {
  cropRatio: TCropRatioValue;
  onRotate: () => void;
  onFlip: (axis: 'x' | 'y') => void;
  onSelectRatio: (ratio: TCropRatioValue) => void;
}

export function EditorTransformPanel({
  cropRatio,
  onRotate,
  onFlip,
  onSelectRatio,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <PanelTitle className="mb-2">Трансформация</PanelTitle>
        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            onClick={onRotate}
            size="md"
            title="Повернуть"
            variant="secondary"
          >
            <Icon name="rotateCw" size="md" />
          </Button>
          <Button
            className="flex-1"
            onClick={() => onFlip('x')}
            size="md"
            title="Отразить по горизонтали"
            variant="secondary"
          >
            <Icon name="flipHorizontal" size="md" />
          </Button>
          <Button
            className="flex-1"
            onClick={() => onFlip('y')}
            size="md"
            title="Отразить по вертикали"
            variant="secondary"
          >
            <Icon name="flipVertical" size="md" />
          </Button>
        </div>
      </div>

      <div>
        <PanelTitle className="mb-2">Пропорции</PanelTitle>
        <div className="grid grid-cols-2 gap-2">
          {EDITOR_RATIOS.map((item) => (
            <Button
              className="text-caption font-bold min-h-10"
              key={item.label}
              onClick={() => onSelectRatio(item.value)}
              variant={cropRatio === item.value ? 'primary' : 'secondary'}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
