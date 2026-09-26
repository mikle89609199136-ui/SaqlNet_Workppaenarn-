import { describe, expect, it } from 'vitest';
import { buildRichBlocks, isSafeLinkUrl, normalizeEntities, trimRichText } from './richText';

describe('форматированный текст (#656)', () => {
  describe('очистка диапазонов', () => {
    it('оставляет годные по порядку и отбрасывает всё остальное', () => {
      const text = 'привет, мир';
      const entities = normalizeEntities(text, [
        { type: 'italic', offset: 8, length: 3 },
        { type: 'bold', offset: 0, length: 6 },
        { type: 'unknown', offset: 0, length: 1 },
        { type: 'bold', offset: 5, length: 100 },
        { type: 'bold', offset: -1, length: 2 },
        { type: 'bold', offset: 0, length: 0 },
        { type: 'bold', offset: 0.5, length: 1 },
        null,
      ]);

      expect(entities).toEqual([
        { type: 'bold', offset: 0, length: 6 },
        { type: 'italic', offset: 8, length: 3 },
      ]);
    });

    it('не режет эмодзи пополам', () => {
      // «😀» — два символа UTF-16.
      expect(normalizeEntities('a😀b', [{ type: 'bold', offset: 2, length: 2 }])).toEqual([]);
      expect(normalizeEntities('a😀b', [{ type: 'bold', offset: 1, length: 2 }])).toHaveLength(1);
    });

    it('пропускает только ссылки по http(s), и не две на одном месте', () => {
      const text = 'один два';
      expect(
        normalizeEntities(text, [
          { type: 'link', offset: 0, length: 4, data: { url: 'javascript:alert(1)' } },
          { type: 'link', offset: 0, length: 4, data: { url: 'https://example.com' } },
          { type: 'link', offset: 2, length: 4, data: { url: 'https://other.example' } },
          { type: 'link', offset: 5, length: 3 },
        ])
      ).toEqual([{ type: 'link', offset: 0, length: 4, data: { url: 'https://example.com' } }]);
      expect(isSafeLinkUrl('http://localhost:3000/x')).toBe(true);
      expect(isSafeLinkUrl('mailto:a@b.c')).toBe(false);
    });

    it('не принимает не-массив', () => {
      expect(normalizeEntities('x', null)).toEqual([]);
      expect(normalizeEntities('x', { type: 'bold' })).toEqual([]);
    });
  });

  it('обрезает пробелы по краям и сдвигает диапазоны', () => {
    expect(
      trimRichText({
        text: '  жирный хвост  ',
        entities: [
          { type: 'bold', offset: 0, length: 8 },
          { type: 'italic', offset: 14, length: 2 },
        ],
      })
    ).toEqual({ text: 'жирный хвост', entities: [{ type: 'bold', offset: 0, length: 6 }] });
  });

  describe('нарезка для отрисовки', () => {
    it('делит текст на куски с одинаковыми форматами', () => {
      const [block] = buildRichBlocks('ab cd', [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'link', offset: 3, length: 2, data: { url: 'https://example.com' } },
      ]);

      expect(block.quote).toBe(false);
      expect(block.segments).toEqual([
        { text: 'ab ', formats: ['bold'] },
        { text: 'cd', formats: ['bold', 'link'], url: 'https://example.com' },
      ]);
    });

    it('выносит цитату отдельным блоком', () => {
      const text = 'до\nцитата\nпосле';
      const blocks = buildRichBlocks(text, [{ type: 'blockquote', offset: 3, length: 6 }]);

      expect(
        blocks.map((block) => [block.quote, block.segments.map((s) => s.text).join('')])
      ).toEqual([
        [false, 'до\n'],
        [true, 'цитата'],
        [false, '\nпосле'],
      ]);
    });

    it('без форматирования — один кусок как есть', () => {
      expect(buildRichBlocks('просто текст', [])).toEqual([
        { quote: false, segments: [{ text: 'просто текст', formats: [] }] },
      ]);
    });
  });
});
