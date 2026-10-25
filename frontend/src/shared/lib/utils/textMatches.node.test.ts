import { describe, expect, it } from 'vitest';
import { findTextMatches } from './textMatches';

describe('поиск совпадений в тексте (#841)', () => {
  it('без учёта регистра и с «ё» как «е»', () => {
    expect(findTextMatches('Ещё созвон, СОЗВОН', 'созвон')).toEqual([
      { start: 4, end: 10 },
      { start: 12, end: 18 },
    ]);
    expect(findTextMatches('Всё ещё', 'все')).toEqual([{ start: 0, end: 3 }]);
  });

  it('индексы — по исходному тексту', () => {
    const text = 'Перед созвоном';
    const [match] = findTextMatches(text, 'СОЗВОН');
    expect(text.slice(match.start, match.end)).toBe('созвон');
  });

  it('пустой запрос и пустой текст — совпадений нет', () => {
    expect(findTextMatches('текст', '   ')).toEqual([]);
    expect(findTextMatches('', 'текст')).toEqual([]);
  });
});
