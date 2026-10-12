import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';
import type { IEditorTextObject } from '../model/types';

interface PillProps {
  onRotateStart: (event: React.PointerEvent) => void;
  onDelete: () => void;
}

/** Ручки над рамкой текста: повернуть (тянуть по кругу) и удалить. */
export function EditorTextHandlePill({ onRotateStart, onDelete }: PillProps) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-pill bg-scrim p-0.5 text-on-scrim shadow-[var(--elev-2)]">
      <button
        aria-label={t('photoEditor.rotateText', 'Повернуть текст')}
        className="grid size-9 cursor-grab touch-none place-items-center rounded-full active:cursor-grabbing hover:layer-hover"
        onPointerDown={onRotateStart}
        title={t('photoEditor.rotateTextHint', 'Потяните, чтобы повернуть')}
        type="button"
      >
        <Icon name="rotateCw" size="sm" />
      </button>
      <button
        aria-label={t('photoEditor.deleteText', 'Удалить текст')}
        className="grid size-9 cursor-pointer place-items-center rounded-full hover:layer-hover"
        onClick={onDelete}
        onPointerDown={(event) => event.preventDefault()}
        type="button"
      >
        <Icon name="trash" size="sm" />
      </button>
    </div>
  );
}

interface Props extends PillProps {
  selectedTextObject: IEditorTextObject;
  canvasDisplayWidth: number;
}

/**
 * Ручки над выбранным, но не редактируемым текстом — над рамкой, которую
 * рисует на холсте drawSelection (кегль × 1.45). Пока текст редактируется,
 * ручки стоят над самим полем ввода (EditorTextOverlay): его высоту
 * заранее не угадать.
 */
export function EditorTextHandles({
  selectedTextObject,
  canvasDisplayWidth,
  onRotateStart,
  onDelete,
}: Props) {
  const boxHalfHeight = selectedTextObject.size * (canvasDisplayWidth / 1000) * 0.725;

  return (
    <div
      className="pointer-events-none absolute z-30 size-0"
      style={{
        left: `${selectedTextObject.x * 100}%`,
        top: `${selectedTextObject.y * 100}%`,
        transform: `rotate(${selectedTextObject.rotation || 0}deg)`,
      }}
    >
      <div
        className="absolute left-0 -translate-x-1/2 -translate-y-full"
        style={{ top: -boxHalfHeight - 8 }}
      >
        <EditorTextHandlePill onDelete={onDelete} onRotateStart={onRotateStart} />
      </div>
    </div>
  );
}
