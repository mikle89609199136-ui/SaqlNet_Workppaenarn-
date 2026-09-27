import { describe, expect, it } from 'vitest';
import { highlightCode } from './highlighter';
import type { TCodeToken } from './types';

const text = (tokens: TCodeToken[]): string =>
  tokens.map((token) => (typeof token === 'string' ? token : text(token.children))).join('');

const classesOf = (tokens: TCodeToken[]): string[] =>
  tokens.flatMap((token) =>
    typeof token === 'string' ? [] : [token.className, ...classesOf(token.children)]
  );

describe('подсветка кода', () => {
  it('язык из ```язык — подсветка по нему, текст не меняется', () => {
    const code = 'const a = "<b>" && 1;';
    const result = highlightCode(code, 'js');

    expect(result.label).toBe('js');
    expect(text(result.tokens)).toBe(code);
    expect(classesOf(result.tokens)).toEqual(
      expect.arrayContaining(['hljs-keyword', 'hljs-string', 'hljs-number'])
    );
  });

  it('язык не указан — определяется сам', () => {
    const code = [
      '// своё сообщение не может быть непрочитанным',
      'const unread = messages.filter((m) => !m.out && m.at > lastRead).length;',
      'badge.textContent = unread > 99 ? "99+" : String(unread);',
    ].join('\n');
    const result = highlightCode(code, '');

    expect(result.label).not.toBe('');
    expect(text(result.tokens)).toBe(code);
    expect(classesOf(result.tokens)).toContain('hljs-comment');
  });

  it('незнакомый язык — подпись как написано, без подсветки', () => {
    expect(highlightCode('x := y', 'brainfuck2')).toEqual({
      label: 'brainfuck2',
      tokens: ['x := y'],
    });
  });

  it('не код — без подписи и подсветки', () => {
    expect(highlightCode('привет', '')).toEqual({ label: '', tokens: ['привет'] });
  });
});
