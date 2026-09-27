import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, EMOJI_KEYWORDS, NOTO_ANIMATED, NOTO_STATIC } from './emoji';

const STATIC_DIR = resolve(import.meta.dirname, '../../../public/emoji/noto');

/* Набор эмодзи и файлы Noto в статике (#824). */
describe('набор эмодзи', () => {
  it('у каждого эмодзи набора есть SVG, у быстрых реакций — анимация', () => {
    const missing = [
      ...[...NOTO_STATIC].filter((code) => !existsSync(`${STATIC_DIR}/${code}.svg`)),
      ...[...NOTO_ANIMATED].filter((code) => !existsSync(`${STATIC_DIR}/${code}.webp`)),
    ];
    expect(missing).toEqual([]);
  });

  it('у каждого эмодзи панели есть слова для поиска', () => {
    const emoji = EMOJI_CATEGORIES.flatMap((category) => category.emoji);
    expect(emoji.filter((item) => !EMOJI_KEYWORDS[item])).toEqual([]);
  });
});
