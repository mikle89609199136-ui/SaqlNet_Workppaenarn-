import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/shared/ui';
import { EDITOR_BRUSHES } from '../model/config';
import type { TBrushType } from '../model/types';
import { ColorPicker, PanelTitle } from './EditorControls';

interface Props {
  brushColor: string;
  brushType: TBrushType;
  onColorChange: (color: string) => void;
  onBrushTypeChange: (brush: TBrushType) => void;
}

/* Две строки — цвет и кисть. Размер кисти задаётся клином у края фото
   (EditorSizeSlider): двигаешь и сразу видишь толщину на снимке. */
export function EditorDrawPanel({
  brushColor,
  brushType,
  onColorChange,
  onBrushTypeChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 md:gap-5">
      <div>
        <PanelTitle>{t('photoEditor.color', 'Цвет')}</PanelTitle>
        <ColorPicker color={brushColor} onChange={onColorChange} />
      </div>

      <div>
        <PanelTitle>{t('photoEditor.tool.draw', 'Кисть')}</PanelTitle>
        <div className="flex flex-wrap max-md:flex-nowrap max-md:justify-between gap-2 max-md:gap-1">
          {EDITOR_BRUSHES.map((brush) => {
            const label = t(`photoEditor.brushes.${brush.id}`, brush.label);
            return (
              <Button
                aria-label={label}
                aria-pressed={brushType === brush.id}
                className="aria-pressed:bg-brand-soft"
                iconOnly
                key={brush.id}
                onClick={() => onBrushTypeChange(brush.id)}
                title={label}
                variant="ghost"
              >
                <Icon name={brush.icon} size="md" />
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
