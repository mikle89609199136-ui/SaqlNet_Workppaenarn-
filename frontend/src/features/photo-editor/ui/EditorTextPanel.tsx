import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';
import { EDITOR_FONTS } from '../model/config';
import type { IEditorTextObject, TTextFontId } from '../model/types';
import { ColorPicker, EditorChip, PanelTitle } from './EditorControls';

interface Props {
  selectedTextObject: IEditorTextObject | null;
  brushColor: string;
  textFont: TTextFontId;
  onAddText: () => void;
  onColorChange: (color: string) => void;
  onFontChange: (font: TTextFontId) => void;
  onUpdateSelectedText: (patch: Partial<IEditorTextObject>, shouldCommit?: boolean) => void;
}

/* Две строки: «+ Текст» со шрифтами и цвет. Размер — клином у края фото,
   поворот и удаление — ручками над рамкой текста (EditorTextHandles). */
export function EditorTextPanel({
  selectedTextObject,
  brushColor,
  textFont,
  onAddText,
  onColorChange,
  onFontChange,
  onUpdateSelectedText,
}: Props) {
  const { t } = useTranslation();
  const activeFont = selectedTextObject?.font || textFont;

  return (
    <div className="flex flex-col gap-3 md:gap-5">
      <div>
        <PanelTitle>{t('photoEditor.font', 'Шрифт')}</PanelTitle>
        <div className="flex gap-2 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] md:flex-wrap">
          <EditorChip
            // «Текст» — уже имя инструмента; две кнопки с одним именем диктор не различит.
            aria-label={t('photoEditor.addText', 'Добавить текст')}
            className="bg-brand-fill text-on-brand"
            onClick={onAddText}
          >
            <Icon name="plus" size="sm" />
            {t('photoEditor.tool.text', 'Текст')}
          </EditorChip>
          {EDITOR_FONTS.map((font) => (
            <EditorChip
              active={activeFont === font.id}
              key={font.id}
              onClick={() => {
                onFontChange(font.id);
                if (selectedTextObject) onUpdateSelectedText({ font: font.id }, true);
              }}
              style={{ fontFamily: font.family }}
            >
              {t(`photoEditor.fonts.${font.id}`, font.label)}
            </EditorChip>
          ))}
        </div>
      </div>

      <div>
        <PanelTitle>{t('photoEditor.color', 'Цвет')}</PanelTitle>
        <ColorPicker
          color={selectedTextObject?.color || brushColor}
          onChange={(value) => {
            onColorChange(value);
            if (selectedTextObject) onUpdateSelectedText({ color: value }, true);
          }}
        />
      </div>
    </div>
  );
}
