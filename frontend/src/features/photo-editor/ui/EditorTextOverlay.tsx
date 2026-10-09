import { EDITOR_FONTS } from '../model/config';
import type { IEditorTextObject } from '../model/types';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  selectedTextObject: IEditorTextObject;
  canvasDisplayWidth: number;
  inlineTextRef: RefObject<HTMLTextAreaElement | null>;
  onBlur: () => void;
  onChange: (value: string) => void;
  /** Ручки над полем (поворот, удаление) — крепятся к нему, а не к расчёту. */
  handles?: ReactNode;
}

/* Поле ввода поверх текста на фото. Ширина — по тексту (field-sizing):
   без неё у textarea ширина в 20 знаков, и «Привет» сидел в длинной
   рамке. Ручки — над полем и поворачиваются вместе с ним. */
export function EditorTextOverlay({
  selectedTextObject,
  canvasDisplayWidth,
  inlineTextRef,
  onBlur,
  onChange,
  handles,
}: Props) {
  const { t } = useTranslation();
  const font = EDITOR_FONTS.find((item) => item.id === selectedTextObject.font) || EDITOR_FONTS[0];
  const fontSize = Math.max(18, selectedTextObject.size * (canvasDisplayWidth / 1000));

  return (
    <div
      className="absolute z-20 max-w-[85%] pointer-events-auto"
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        left: `${selectedTextObject.x * 100}%`,
        top: `${selectedTextObject.y * 100}%`,
        transform: `translate(-50%, -50%) rotate(${selectedTextObject.rotation || 0}deg)`,
      }}
    >
      {handles && (
        <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2">{handles}</div>
      )}
      <textarea
        aria-label={t('photoEditor.textOnImage', 'Текст на изображении')}
        className="block min-w-[120px] max-w-[min(70vw,720px)] w-max [field-sizing:content] resize-none overflow-hidden border border-dashed border-white/90 rounded-field px-2 py-0.5 bg-black/20 text-center caret-white outline-none"
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
        placeholder={t('editorTextPlaceholder', 'Введите текст')}
        ref={inlineTextRef}
        rows={1}
        style={{
          color: selectedTextObject.color,
          fontFamily: font.family,
          fontSize: `${fontSize}px`,
          lineHeight: 1.2,
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          WebkitTextStroke: '1px rgba(0,0,0,0.45)',
        }}
        value={selectedTextObject.text}
      />
    </div>
  );
}
