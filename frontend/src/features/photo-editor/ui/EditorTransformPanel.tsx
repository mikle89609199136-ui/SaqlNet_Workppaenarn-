import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/shared/ui';
import { EDITOR_RATIOS } from '../model/config';
import type { TCropRatioValue } from '../model/types';
import { EditorChip, PanelTitle } from './EditorControls';

interface Props {
  cropRatio: TCropRatioValue;
  onRotate: () => void;
  onFlip: (axis: 'x' | 'y') => void;
  onSelectRatio: (ratio: TCropRatioValue) => void;
}

/* Прямоугольник нужной формы у числовой пропорции: «4:5» и «5:4»
   различаются с одного взгляда. Сторона побольше — 16px. */
function RatioGlyph({ ratio }: { ratio: number }) {
  const width = ratio >= 1 ? 16 : Math.round(16 * ratio);
  const height = ratio >= 1 ? Math.round(16 / ratio) : 16;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-[2px] border-[1.6px] border-current opacity-80"
      style={{ width, height }}
    />
  );
}

/* Две строки: пропорции (на телефоне листаются пальцем) и поворот с
   отражением. «Сбросить» — в верхней строке редактора. */
export function EditorTransformPanel({ cropRatio, onRotate, onFlip, onSelectRatio }: Props) {
  const { t } = useTranslation();
  /* Числовые пропорции («3:2») одинаковы на любом языке — переводятся
     только словесные. */
  const ratioLabel = (value: TCropRatioValue, label: string) => {
    if (value === null) return t('photoEditor.ratios.free', label);
    if (value === 'original') return t('photoEditor.ratios.original', label);
    if (value === 1) return t('photoEditor.ratios.square', label);
    return label;
  };
  const rotate = t('photoEditor.rotate', 'Повернуть');
  const flipX = t('photoEditor.flipX', 'Отразить по горизонтали');
  const flipY = t('photoEditor.flipY', 'Отразить по вертикали');
  return (
    <div className="flex flex-col gap-2 md:gap-5">
      <div>
        <PanelTitle>{t('photoEditor.ratio', 'Пропорции')}</PanelTitle>
        <div className="flex gap-2 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] md:flex-wrap">
          {EDITOR_RATIOS.map((item) => (
            <EditorChip
              active={cropRatio === item.value}
              key={item.label}
              onClick={() => onSelectRatio(item.value)}
            >
              {typeof item.value === 'number' && <RatioGlyph ratio={item.value} />}
              {ratioLabel(item.value, item.label)}
            </EditorChip>
          ))}
        </div>
      </div>

      <div>
        <PanelTitle>{t('photoEditor.rotateFlip', 'Поворот и отражение')}</PanelTitle>
        <div className="flex items-center gap-1">
          <Button aria-label={rotate} iconOnly onClick={onRotate} title={rotate} variant="ghost">
            <Icon name="rotateCw" size="md" />
          </Button>
          <Button
            aria-label={flipX}
            iconOnly
            onClick={() => onFlip('x')}
            title={flipX}
            variant="ghost"
          >
            <Icon name="flipHorizontal" size="md" />
          </Button>
          <Button
            aria-label={flipY}
            iconOnly
            onClick={() => onFlip('y')}
            title={flipY}
            variant="ghost"
          >
            <Icon name="flipVertical" size="md" />
          </Button>
        </div>
      </div>
    </div>
  );
}
