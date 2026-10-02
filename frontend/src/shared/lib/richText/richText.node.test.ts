import { describe, expect, it } from 'vitest';
import {
  buildRichBlocks,
  escapeHtml,
  isSafeLinkUrl,
  normalizeEntities,
  richTextToHtml,
  trimRichText,
  type IMessageEntity,
} from './richText';

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

      expect(block.kind).toBe('text');
      expect(block.segments).toEqual([
        { text: 'ab ', formats: ['bold'] },
        { text: 'cd', formats: ['bold', 'link'], url: 'https://example.com' },
      ]);
    });

    const outline = (text: string, entities: IMessageEntity[] = []) =>
      buildRichBlocks(text, entities).map((block) =>
        block.kind === 'code'
          ? [block.kind, block.code, block.lang]
          : [block.kind, block.segments.map((s) => s.text).join('')]
      );
    const mono = (offset: number, length: number): IMessageEntity => ({
      type: 'monospace',
      offset,
      length,
    });

    it('выносит цитату отдельным блоком, переводы строк на границах — сама граница', () => {
      expect(outline('до\nцитата\nпосле', [{ type: 'blockquote', offset: 3, length: 6 }])).toEqual([
        ['text', 'до'],
        ['quote', 'цитата'],
        ['text', 'после'],
      ]);
    });

    it('без форматирования — один кусок как есть', () => {
      expect(buildRichBlocks('просто текст', [])).toEqual([
        { kind: 'text', segments: [{ text: 'просто текст', formats: [] }] },
      ]);
    });

    it('```язык … ``` в тексте — блок кода с языком', () => {
      expect(outline('Смотри:\n```js\nconst a = 1;\nlog(a);\n```\nГотово')).toEqual([
        ['text', 'Смотри:'],
        ['code', 'const a = 1;\nlog(a);', 'js'],
        ['text', 'Готово'],
      ]);
    });

    it('ограждение без языка и в одну строку; непарное остаётся текстом', () => {
      expect(outline('```npm i```')).toEqual([['code', 'npm i', '']]);
      expect(outline('```\nx = 1\n```')).toEqual([['code', 'x = 1', '']]);
      expect(outline('три ``` кавычки')).toEqual([['text', 'три ``` кавычки']]);
    });

    it('строки подряд целиком моноширинные — блок кода, пустая строка его не рвёт', () => {
      const text = 'Вот:\nif (a) {\n\n  go();\n}\nи всё, x';

      expect(outline(text, [mono(5, 8), mono(15, 7), mono(23, 1), mono(32, 1)])).toEqual([
        ['text', 'Вот:'],
        ['code', 'if (a) {\n\n  go();\n}', ''],
        ['text', 'и всё, x'],
      ]);
    });

    it('одна моноширинная строка — код в строке, а не блок', () => {
      expect(outline('npm i', [mono(0, 5)])).toEqual([['text', 'npm i']]);
    });

    it('ограждение внутри цитаты — часть цитаты', () => {
      const text = '```a```';
      expect(outline(text, [{ type: 'blockquote', offset: 0, length: text.length }])).toEqual([
        ['quote', text],
      ]);
    });
  });

  describe('преобразование в HTML для буфера обмена (#891)', () => {
    it('экранирует спецсимволы HTML', () => {
      expect(escapeHtml('<b>"hello" & \'world\'</b>')).toBe(
        '&lt;b&gt;&quot;hello&quot; &amp; &#39;world&#39;&lt;/b&gt;'
      );
    });

    it('форматирует инлайн-стили: жирный, курсив, подчёркивание, зачёркивание, моно, спойлер, ссылка', () => {
      const text = 'жирный курсив подчёркнутый зачёркнутый код спойлер ссылка';
      const entities: IMessageEntity[] = [
        { type: 'bold', offset: 0, length: 6 },
        { type: 'italic', offset: 7, length: 6 },
        { type: 'underline', offset: 14, length: 12 },
        { type: 'strikethrough', offset: 27, length: 11 },
        { type: 'monospace', offset: 39, length: 3 },
        { type: 'spoiler', offset: 43, length: 7 },
        { type: 'link', offset: 51, length: 6, data: { url: 'https://example.com' } },
      ];

      const html = richTextToHtml({ text, entities });
      expect(html).toContain('<b>жирный</b>');
      expect(html).toContain('<i>курсив</i>');
      expect(html).toContain('<u>подчёркнутый</u>');
      expect(html).toContain('<s>зачёркнутый</s>');
      expect(html).toContain('<code>код</code>');
      expect(html).toContain('<mark class="tg-spoiler">спойлер</mark>');
      expect(html).toContain('<a href="https://example.com">ссылка</a>');
    });

    it('форматирует цитату и блок кода', () => {
      const text = 'до\nцитата\n```js\nconst a = 1;\n```\nпосле';
      const entities: IMessageEntity[] = [{ type: 'blockquote', offset: 3, length: 6 }];

      const html = richTextToHtml({ text, entities });
      expect(html).toContain('<blockquote>цитата</blockquote>');
      expect(html).toContain('<pre><code>const a = 1;</code></pre>');
    });

    it('сохраняет переносы строк как <br>', () => {
      const html = richTextToHtml({ text: 'строка 1\nстрока 2', entities: [] });
      expect(html).toBe('строка 1<br>строка 2');
    });
  });
});
