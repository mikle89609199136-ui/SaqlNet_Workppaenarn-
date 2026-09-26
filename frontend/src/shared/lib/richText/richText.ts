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

export interface IRichBlock {
  quote: boolean;
  segments: IRichSegment[];
}

/**
 * Текст, нарезанный для отрисовки: цитаты — отдельными блоками, внутри
 * блока — куски с одинаковым набором форматов.
 */
export function buildRichBlocks(text: string, entities: IMessageEntity[]): IRichBlock[] {
  const quotes = entities
    .filter((entity) => entity.type === 'blockquote')
    .map((entity) => [entity.offset, entity.offset + entity.length] as const);
  const inline = entities.filter((entity) => entity.type !== 'blockquote');

  // Границы блоков: начала и концы цитат; пересекающиеся цитаты склеиваются.
  const ranges: Array<{ quote: boolean; start: number; end: number }> = [];
  let cursor = 0;
  for (const [from, to] of [...quotes].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(from, cursor);
    if (to <= start) continue;
    if (start > cursor) ranges.push({ quote: false, start: cursor, end: start });
    ranges.push({ quote: true, start, end: to });
    cursor = to;
  }
  if (cursor < text.length || ranges.length === 0) {
    ranges.push({ quote: false, start: cursor, end: text.length });
  }

  return ranges.map(({ quote, start, end }) => {
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

    return { quote, segments };
  });
}
