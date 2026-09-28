import { describe, expect, it } from 'vitest';
import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { LinkNode } from '@lexical/link';
import { QuoteNode } from '@lexical/rich-text';
import type { IRichText } from '@/shared/lib/richText';
import { $readRichText, $writeRichText } from './lexicalRichText';

function editor() {
  return createEditor({
    nodes: [QuoteNode, LinkNode],
    onError: (error) => {
      throw error;
    },
  });
}

function roundTrip(value: IRichText): IRichText {
  const instance = editor();
  instance.update(() => $writeRichText(value), { discrete: true });
  return instance.getEditorState().read($readRichText);
}

describe('редактор ↔ форматированный текст (#656)', () => {
  it('переносит все восемь видов туда и обратно без потерь', () => {
    const value: IRichText = {
      text: 'жирный курсив подчёркнутый зачёркнутый скрытый код ссылка\nцитата',
      entities: [
        { type: 'bold', offset: 0, length: 6 },
        { type: 'italic', offset: 7, length: 6 },
        { type: 'underline', offset: 14, length: 12 },
        { type: 'strikethrough', offset: 27, length: 11 },
        { type: 'spoiler', offset: 39, length: 7 },
        { type: 'monospace', offset: 47, length: 3 },
        { type: 'link', offset: 51, length: 6, data: { url: 'https://example.com/docs' } },
        { type: 'blockquote', offset: 58, length: 6 },
      ],
    };

    expect(roundTrip(value)).toEqual(value);
  });

  it('держит пересекающиеся форматы и эмодзи', () => {
    const value: IRichText = {
      text: 'a😀bc',
      entities: [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'italic', offset: 1, length: 3 },
      ],
    };

    expect(roundTrip(value)).toEqual(value);
  });

  it('склеивает соседние строки цитаты в одну', () => {
    const value: IRichText = {
      text: 'до\nпервая\nвторая\nпосле',
      entities: [{ type: 'blockquote', offset: 3, length: 13 }],
    };

    expect(roundTrip(value)).toEqual(value);
  });

  it('обычный текст без форматирования остаётся обычным', () => {
    expect(roundTrip({ text: 'просто\nтекст', entities: [] })).toEqual({
      text: 'просто\nтекст',
      entities: [],
    });
  });

  it('склеивает одинаковый формат из соседних узлов', () => {
    const instance = editor();
    instance.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode('раз').toggleFormat('bold'),
          $createTextNode('два').toggleFormat('bold').toggleFormat('italic')
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    expect(instance.getEditorState().read($readRichText)).toEqual({
      text: 'раздва',
      entities: [
        { type: 'bold', offset: 0, length: 6 },
        { type: 'italic', offset: 3, length: 3 },
      ],
    });
  });
});
