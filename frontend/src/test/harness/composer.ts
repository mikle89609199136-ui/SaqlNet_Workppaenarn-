import { act } from '@testing-library/react';
import type { LexicalEditor } from 'lexical';
import type { IRichText } from '@/shared/lib/richText';
import { $writeRichText } from '@/shared/ui/RichTextInput/lexicalRichText';

/**
 * Поле ввода сообщения — редактор Lexical (#656). В jsdom набор с
 * клавиатуры до него не доходит: редактору нужны beforeinput и выделение,
 * которых там нет. Поэтому текст кладётся через сам редактор — так же, как
 * его положил бы набор, без пометки «записано программой»: поле считает это
 * вводом человека. Enter при этом нажимается по-настоящему.
 */
export function composerEditor(element: HTMLElement): LexicalEditor {
  const editor = (element as unknown as { __lexicalEditor?: LexicalEditor }).__lexicalEditor;
  if (!editor) throw new Error('Это не поле ввода с редактором');
  return editor;
}

export async function typeIntoComposer(element: HTMLElement, value: string | IRichText) {
  const editor = composerEditor(element);
  await act(async () => {
    editor.update(
      () => $writeRichText(typeof value === 'string' ? { text: value, entities: [] } : value),
      { discrete: true }
    );
  });
}
