import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type ElementNode,
  type TextFormatType,
} from 'lexical';
import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text';
import {
  normalizeEntities,
  type IMessageEntity,
  type IRichText,
  type TInlineEntityType,
} from '@/shared/lib/richText';

/**
 * Перевод между состоянием Lexical и форматированным текстом сообщения
 * (#656) в обе стороны.
 *
 * Каждый абзац редактора — строка сообщения, между абзацами `\n`. Форматы
 * текстовых узлов становятся диапазонами; ссылка и цитата — свои узлы.
 * Спойлера среди форматов Lexical нет, поэтому он живёт в `highlight`, а
 * моноширинный — в `code`.
 */

const FORMAT_BY_ENTITY: Record<Exclude<TInlineEntityType, 'link'>, TextFormatType> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strikethrough',
  spoiler: 'highlight',
  monospace: 'code',
};

const FORMATTED = Object.entries(FORMAT_BY_ENTITY) as Array<
  [Exclude<TInlineEntityType, 'link'>, TextFormatType]
>;

/** Соседние одинаковые диапазоны — одним: узлы Lexical дробятся часто. */
function mergeAdjacent(entities: IMessageEntity[]): IMessageEntity[] {
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  const merged: IMessageEntity[] = [];

  for (const entity of sorted) {
    const previous = [...merged]
      .reverse()
      .find((item) => item.type === entity.type && item.offset + item.length >= entity.offset);
    const sameLink = entity.type !== 'link' || previous?.data?.url === entity.data?.url;

    if (previous && sameLink) {
      const end = Math.max(previous.offset + previous.length, entity.offset + entity.length);
      previous.length = end - previous.offset;
    } else {
      merged.push({ ...entity });
    }
  }

  return merged;
}

/** Состояние редактора → текст и диапазоны. Вызывать внутри read/update. */
export function $readRichText(): IRichText {
  let text = '';
  const entities: IMessageEntity[] = [];

  const walk = (parent: ElementNode, url: string | null) => {
    for (const child of parent.getChildren()) {
      if ($isLineBreakNode(child)) {
        text += '\n';
      } else if ($isTextNode(child)) {
        const piece = child.getTextContent();
        const offset = text.length;
        text += piece;
        if (!piece) continue;

        for (const [type, format] of FORMATTED) {
          if (child.hasFormat(format)) entities.push({ type, offset, length: piece.length });
        }
        if (url) entities.push({ type: 'link', offset, length: piece.length, data: { url } });
      } else if ($isLinkNode(child)) {
        walk(child, child.getURL());
      } else if ($isElementNode(child)) {
        walk(child, url);
      }
    }
  };

  const blocks = $getRoot().getChildren();
  blocks.forEach((block, index) => {
    if (index > 0) text += '\n';
    const start = text.length;
    if ($isElementNode(block)) walk(block, null);

    // Соседние цитаты — одна цитата, вместе с переводом строки между ними.
    if ($isQuoteNode(block) && text.length > start) {
      const previous = [...entities].reverse().find((entity) => entity.type === 'blockquote');
      if (previous && previous.offset + previous.length === start - 1) {
        previous.length = text.length - previous.offset;
      } else {
        entities.push({ type: 'blockquote', offset: start, length: text.length - start });
      }
    }
  });

  return { text, entities: normalizeEntities(text, mergeAdjacent(entities)) };
}

/**
 * Текст и диапазоны → состояние редактора (правка сообщения, черновик).
 * Вызывать внутри update: содержимое корня заменяется целиком.
 */
export function $writeRichText({ text, entities }: IRichText): void {
  const root = $getRoot();
  root.clear();

  const clean = normalizeEntities(text, entities);
  const quotes = clean.filter((entity) => entity.type === 'blockquote');
  const inline = clean.filter((entity) => entity.type !== 'blockquote');

  let lineStart = 0;
  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length;
    const quoted = quotes.some(
      (quote) => quote.offset <= lineStart && quote.offset + quote.length >= lineEnd && line
    );
    const block = quoted ? $createQuoteNode() : $createParagraphNode();

    const cuts = new Set([lineStart, lineEnd]);
    for (const entity of inline) {
      for (const point of [entity.offset, entity.offset + entity.length]) {
        if (point > lineStart && point < lineEnd) cuts.add(point);
      }
    }
    const points = [...cuts].sort((a, b) => a - b);

    let link: ReturnType<typeof $createLinkNode> | null = null;
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i];
      const to = points[i + 1];
      const covering = inline.filter(
        (entity) => entity.offset <= from && entity.offset + entity.length >= to
      );

      const node = $createTextNode(text.slice(from, to));
      for (const entity of covering) {
        if (entity.type !== 'link') node.toggleFormat(FORMAT_BY_ENTITY[entity.type]);
      }

      const url = covering.find((entity) => entity.type === 'link')?.data?.url;
      if (url) {
        if (!link || link.getURL() !== url) {
          link = $createLinkNode(url);
          block.append(link);
        }
        link.append(node);
      } else {
        link = null;
        block.append(node);
      }
    }

    root.append(block);
    lineStart = lineEnd + 1;
  }
}

/** Пусто ли — по тексту, а не по узлам: пустые абзацы тоже узлы. */
export function isRichTextEmpty(value: IRichText): boolean {
  return value.text.trim() === '';
}
