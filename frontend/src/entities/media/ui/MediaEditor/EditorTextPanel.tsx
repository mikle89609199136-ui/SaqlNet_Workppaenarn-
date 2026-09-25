import { Button, Icon } from '@/shared/ui';
import { EDITOR_FONTS } from '@/shared/config';
import type { IEditorTextObject, TTextFontId } from '@/shared/types';
import { ColorPicker, EditorRange, PanelTitle } from './EditorControls';

interface Props {
  selectedTextObject: IEditorTextObject | null;
  brushColor: string;
  textFont: TTextFontId;
  onAddText: () => void;
  onDeleteText: () => void;
  onColorChange: (color: string) => void;
  onFontChange: (font: TTextFontId) => void;
  onUpdateSelectedText: (patch: Partial<IEditorTextObject>, shouldCommit?: boolean) => void;
  onCommit: () => void;
}

export function EditorTextPanel({
  selectedTextObject,
  brushColor,
  textFont,
  onAddText,
  onDeleteText,
  onColorChange,
  onFontChange,
  onUpdateSelectedText,
  onCommit,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-caption text-ink-3 m-0">
          Нажмите на изображение и вводите текст прямо поверх него.
        </p>
        <div className="flex items-center gap-2">
          <Button
            className="flex-1 flex items-center justify-center gap-1.5"
            onClick={onAddText}
            size="md"
            variant="secondary"
          >
            <Icon name="plus" size="sm" />
            <span>Добавить по центру</span>
          </Button>
          <Button
            aria-label="Удалить выбранный текст"
            disabled={!selectedTextObject}
            onClick={onDeleteText}
            size="md"
            variant="danger"
          >
            <Icon name="trash" size="sm" />
          </Button>
        </div>
      </div>

      <div>
        <PanelTitle className="mb-2">Цвет</PanelTitle>
        <ColorPicker
          color={selectedTextObject?.color || brushColor}
          onChange={(value) => {
            onColorChange(value);
            if (selectedTextObject) onUpdateSelectedText({ color: value }, true);
          }}
        />
      </div>

      <div>
        <PanelTitle className="mb-2">Шрифт</PanelTitle>
        <div className="grid grid-cols-2 gap-2">
          {EDITOR_FONTS.map((font) => (
            <Button
              className="min-h-10 text-caption font-bold"
              key={font.id}
              onClick={() => {
                onFontChange(font.id);
                if (selectedTextObject) onUpdateSelectedText({ font: font.id }, true);
              }}
              style={{ fontFamily: font.family }}
              variant={(selectedTextObject?.font || textFont) === font.id ? 'primary' : 'secondary'}
            >
              {font.label}
            </Button>
          ))}
        </div>
      </div>

      <EditorRange
        label="Размер текста"
        max={180}
        min={20}
        onAfterChange={() => selectedTextObject && onCommit()}
        onChange={(value) => selectedTextObject && onUpdateSelectedText({ size: value })}
        suffix=""
        value={selectedTextObject?.size || 64}
      />

      <EditorRange
        label="Поворот текста"
        max={180}
        min={-180}
        onAfterChange={() => selectedTextObject && onCommit()}
        onChange={(value) => selectedTextObject && onUpdateSelectedText({ rotation: value })}
        suffix="°"
        value={selectedTextObject?.rotation || 0}
      />
    </div>
  );
}
