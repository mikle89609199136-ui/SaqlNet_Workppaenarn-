/**
 * Форматированный текст сообщения (#656): строка и диапазоны форматирования
 * поверх неё, без HTML.
 *
 * Модель та же, что в контракте сервера (`MessageEntity`): смещения и длины —
 * в единицах UTF-16, то есть ровно то, что считает `String.length`. В
 * зашифрованных чатах диапазоны едут внутри шифровки вместе с текстом, и
 * сервер их не видит.
 */

export type TInlineEntityType =
  'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'monospace' | 'link';

export type TEntityType = TInlineEntityType | 'blockquote';

export interface IMessageEntity {
  type: TEntityType;
  offset: number;
  length: number;
  /** Только у ссылки. */
  data?: { url: string };
}

export interface IRichText {
  text: string;
  entities: IMessageEntity[];
}

/** Столько же принимает сервер. */
export const MAX_ENTITIES = 100;

const ENTITY_TYPES = new Set<TEntityType>([
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'spoiler',
  'monospace',
  'link',
  'blockquote',
]);

/** Ссылка только наружу по http(s): javascript: и прочее не открываем. */
export function isSafeLinkUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.host);
  } catch {
    return false;
  }
}

/** Граница не должна резать пару суррогатов: эмодзи распалось бы надвое. */
function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/**
 * Только годные диапазоны, по порядку.
 *
 * Пришедшее из расшифровки не проверял никто, кроме отправителя, поэтому
 * лишнее молча отбрасывается, а не ломает показ: неизвестный тип, выход за
 * текст, разрезанный эмодзи, ссылка не по http(s), вторая ссылка поверх
 * первой.
 */
export function normalizeEntities(text: string, entities: unknown): IMessageEntity[] {
  if (!Array.isArray(entities)) return [];

  const result: IMessageEntity[] = [];
  const links: IMessageEntity[] = [];

  for (const raw of entities) {
    if (result.length >= MAX_ENTITIES) break;
    if (typeof raw !== 'object' || raw === null) continue;

    const { type, offset, length, data } = raw as Partial<IMessageEntity>;
    if (!ENTITY_TYPES.has(type as TEntityType)) continue;
    if (!Number.isInteger(offset) || !Number.isInteger(length)) continue;

    const start = offset as number;
    const end = start + (length as number);
    if (start < 0 || (length as number) <= 0 || end > text.length) continue;
    if (splitsSurrogatePair(text, start) || splitsSurrogatePair(text, end)) continue;

    const entity: IMessageEntity = {
      type: type as TEntityType,
      offset: start,
      length: end - start,
    };

    if (type === 'link') {
      if (!isSafeLinkUrl(data?.url)) continue;
      if (links.some((link) => start < link.offset + link.length && link.offset < end)) continue;
      entity.data = { url: data.url };
      links.push(entity);
    }

    result.push(entity);
  }

  return result.sort((a, b) => a.offset - b.offset || b.length - a.length);
}

/**
 * Без пробелов по краям — как отправляется обычный текст. Диапазоны
 * сдвигаются вместе с текстом, а то, что целиком ушло в пробелы, пропадает.
 */
export function trimRichText({ text, entities }: IRichText): IRichText {
  const start = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const end = start + trimmed.length;

  const shifted = entities.flatMap((entity) => {
    const from = Math.max(entity.offset, start);
    const to = Math.min(entity.offset + entity.length, end);
    return to > from ? [{ ...entity, offset: from - start, length: to - from }] : [];
  });

  return { text: trimmed, entities: normalizeEntities(trimmed, shifted) };
}

export interface IRichSegment {
  text: string;
  formats: TInlineEntityType[];
  url?: string;
}

export type TRichBlockKind = 'text' | 'quote' | 'code';

export interface IRichBlock {
  kind: TRichBlockKind;
  /** Куски с одинаковыми форматами; у блока кода пусто — там `code`. */
  segments: IRichSegment[];
  /** Только у блока кода: сам код, без ограждения. */
  code?: string;
  /** Только у блока кода: язык из «```язык»; пусто — угадывается при показе. */
  lang?: string;
}

interface IBlockRange {
  kind: TRichBlockKind;
  start: number;
  end: number;
  code?: string;
  lang?: string;
}

const FENCE = '```';
const FENCE_LANG = /^([A-Za-z0-9+#-]{1,12})\n([\s\S]*)$/;

const overlaps = (a: IBlockRange, b: IBlockRange) => a.start < b.end && b.start < a.end;

/**
 * Блоки кода, набранные прямо в тексте: «```» или «```язык» с новой строки,
 * код, «```». Непарное ограждение остаётся текстом.
 */
function fencedCode(text: string): IBlockRange[] {
  const ranges: IBlockRange[] = [];
  let from = 0;

  for (;;) {
    const open = text.indexOf(FENCE, from);
    if (open < 0) break;
    const close = text.indexOf(FENCE, open + FENCE.length);
    if (close < 0) break;

    const inner = text.slice(open + FENCE.length, close);
    const withLang = inner.match(FENCE_LANG);
    const code = (withLang ? withLang[2] : inner.replace(/^\n/, '')).replace(/\n$/, '');
    if (code.trim()) {
      ranges.push({
        kind: 'code',
        start: open,
        end: close + FENCE.length,
        code,
        lang: withLang?.[1] ?? '',
      });
    }
    from = close + FENCE.length;
  }

  return ranges;
}

/**
 * Блоки кода из поля ввода: моноширинный там ставится на строку, и через
 * перевод строки диапазон не переходит. Две и больше строки подряд, целиком
 * моноширинные (пустые между ними не прерывают), — это код, а не слово в
 * строке.
 */
function monospaceCode(
  text: string,
  entities: IMessageEntity[],
  taken: IBlockRange[]
): IBlockRange[] {
  const mono = entities
    .filter((entity) => entity.type === 'monospace')
    .sort((a, b) => a.offset - b.offset);
  if (mono.length === 0) return [];

  const covered = (from: number, to: number) => {
    let reach = from;
    for (const entity of mono) {
      if (entity.offset > reach) break;
      reach = Math.max(reach, entity.offset + entity.length);
    }
    return reach >= to;
  };

  const ranges: IBlockRange[] = [];
  let run: { start: number; end: number; lines: number } | null = null;
  const flush = () => {
    if (run && run.lines >= 2) {
      ranges.push({
        kind: 'code',
        start: run.start,
        end: run.end,
        code: text.slice(run.start, run.end),
        lang: '',
      });
    }
    run = null;
  };

  let start = 0;
  for (const line of text.split('\n')) {
    const end = start + line.length;
    const free = !taken.some((range) => range.start < end + 1 && start < range.end);

    if (free && line.length > 0 && covered(start, end)) {
      if (run) {
        run.end = end;
        run.lines += 1;
      } else {
        run = { start, end, lines: 1 };
      }
    } else if (!(free && run && line.trim() === '')) {
      flush();
    }
    start = end + 1;
  }
  flush();

  return ranges;
}

/**
 * Текст, нарезанный для отрисовки: цитаты и блоки кода — отдельными
 * блоками, внутри остальных — куски с одинаковым набором форматов.
 *
 * Перевод строки на границе блока — сама граница: блок и так начинается
 * с новой строки, иначе над ним и под ним появлялись бы пустые строки.
 */
export function buildRichBlocks(text: string, entities: IMessageEntity[]): IRichBlock[] {
  const inline = entities.filter((entity) => entity.type !== 'blockquote');

  // Пересекающиеся цитаты склеиваются.
  const quotes: IBlockRange[] = [];
  let quoteEnd = 0;
  for (const entity of entities
    .filter((item) => item.type === 'blockquote')
    .sort((a, b) => a.offset - b.offset)) {
    const start = Math.max(entity.offset, quoteEnd);
    const end = entity.offset + entity.length;
    if (end <= start) continue;
    quotes.push({ kind: 'quote', start, end });
    quoteEnd = end;
  }

  const fences = fencedCode(text).filter(
    (fence) => !quotes.some((quote) => overlaps(quote, fence))
  );
  const blocks = [
    ...quotes,
    ...fences,
    ...monospaceCode(text, inline, [...quotes, ...fences]),
  ].sort((a, b) => a.start - b.start);

  const ranges: IBlockRange[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const end =
      block.start > cursor && text[block.start - 1] === '\n' ? block.start - 1 : block.start;
    if (end > cursor) ranges.push({ kind: 'text', start: cursor, end });
    ranges.push(block);
    cursor = text[block.end] === '\n' ? block.end + 1 : block.end;
  }
  if (cursor < text.length || ranges.length === 0) {
    ranges.push({ kind: 'text', start: cursor, end: text.length });
  }

  return ranges.map(({ kind, start, end, code, lang }) => {
    if (kind === 'code') return { kind, segments: [], code, lang };

    const cuts = new Set([start, end]);
    for (const entity of inline) {
      for (const point of [entity.offset, entity.offset + entity.length]) {
        if (point > start && point < end) cuts.add(point);
      }
    }
    const points = [...cuts].sort((a, b) => a - b);

    const segments: IRichSegment[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i];
      const to = points[i + 1];
      const covering = inline.filter(
        (entity) => entity.offset <= from && entity.offset + entity.length >= to
      );
      const link = covering.find((entity) => entity.type === 'link');
      segments.push({
        text: text.slice(from, to),
        formats: [...new Set(covering.map((entity) => entity.type as TInlineEntityType))],
        ...(link?.data ? { url: link.data.url } : {}),
      });
    }

    return { kind, segments };
  });
}

/** Экранирование специальных символов HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Преобразование форматированного текста сообщения в HTML для буфера обмена (#891).
 * Сохраняет жирный, курсив, подчёркивание, зачёркивание, моноширинный,
 * скрытый текст (спойлер), ссылки, цитаты и блоки кода.
 */
export function richTextToHtml({ text, entities }: IRichText): string {
  if (!text) return '';

  const clean = entities?.length ? normalizeEntities(text, entities) : [];
  const blocks = buildRichBlocks(text, clean);

  const renderSegment = (segment: IRichSegment): string => {
    let content = escapeHtml(segment.text).replace(/\n/g, '<br>');

    if (segment.formats.includes('monospace')) {
      content = `<code>${content}</code>`;
    }
    if (segment.formats.includes('bold')) {
      content = `<b>${content}</b>`;
    }
    if (segment.formats.includes('italic')) {
      content = `<i>${content}</i>`;
    }
    if (segment.formats.includes('underline')) {
      content = `<u>${content}</u>`;
    }
    if (segment.formats.includes('strikethrough')) {
      content = `<s>${content}</s>`;
    }
    if (segment.formats.includes('spoiler')) {
      content = `<mark class="tg-spoiler">${content}</mark>`;
    }
    if (segment.url && isSafeLinkUrl(segment.url)) {
      content = `<a href="${escapeHtml(segment.url)}">${content}</a>`;
    }

    return content;
  };

  const htmlBlocks = blocks.map((block) => {
    if (block.kind === 'code') {
      return `<pre><code>${escapeHtml(block.code ?? '')}</code></pre>`;
    }
    const inner = block.segments.map(renderSegment).join('');
    if (block.kind === 'quote') {
      return `<blockquote>${inner}</blockquote>`;
    }
    return inner;
  });

  return htmlBlocks.join('');
}

/**
 * Запись форматированного текста в буфер обмена (text/plain и text/html, #891).
 * Если ClipboardItem или navigator.clipboard.write недоступны — фоллбэк на writeText.
 */
export async function copyRichTextToClipboard(plainText: string, htmlText: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard API unavailable');
  }

  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    try {
      const item = new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // Некоторые браузеры могут блокировать запись HTML без расширенных разрешений
    }
  }

  if (typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(plainText);
    return;
  }

  throw new Error('Clipboard write failed');
}
