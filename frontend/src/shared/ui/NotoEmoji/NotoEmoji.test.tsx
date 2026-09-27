import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotoEmoji } from './NotoEmoji';

/* Тесты идут без изоляции (isolate: false), и чужой файл может оставить
   свою подмену matchMedia. Поэтому «уменьшить движение» задаём явно. */
function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

const srcs = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

/* Эмодзи картинкой Noto из статики приложения (#824). */
describe('NotoEmoji', () => {
  beforeEach(() => mockReducedMotion(false));
  afterEach(() => vi.restoreAllMocks());

  it('из набора — статичная SVG, «❤️» без селектора вида', () => {
    const { container } = render(<NotoEmoji emoji="❤️" size={20} />);
    expect(srcs(container)).toEqual(['/emoji/noto/2764.svg']);
  });

  it('анимация — поверх статичной и только у быстрых реакций', () => {
    const { container, rerender } = render(<NotoEmoji animated emoji="🔥" size={20} />);
    expect(srcs(container)).toEqual(['/emoji/noto/1f525.svg', '/emoji/noto/1f525.webp']);

    // У 🍕 анимации нет — остаётся статичная.
    rerender(<NotoEmoji animated emoji="🍕" size={20} />);
    expect(srcs(container)).toEqual(['/emoji/noto/1f355.svg']);
  });

  it('при «уменьшить движение» анимация не грузится', () => {
    mockReducedMotion(true);
    const { container } = render(<NotoEmoji animated emoji="🔥" size={20} />);
    expect(srcs(container)).toEqual(['/emoji/noto/1f525.svg']);
  });

  it('не из набора — символ шрифтом, без запросов наружу', () => {
    const { container } = render(<NotoEmoji emoji="🦒" size={20} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('🦒');
  });
});
