import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotoEmoji } from './NotoEmoji';

/* Тесты идут без изоляции (isolate: false): matchMedia общий на файлы, и
   чужой файл мог оставить свою подмену. «Уменьшить движение» задаём своей
   функцией и после возвращаем прежнюю как есть. Не spyOn: если прежняя —
   сама vi.fn, spyOn вернул бы её же, и восстановление сбросило бы
   заглушку всем соседям. */
const originalMatchMedia = window.matchMedia;

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const srcs = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

/* Эмодзи картинкой Noto из статики приложения (#824). */
describe('NotoEmoji', () => {
  beforeEach(() => mockReducedMotion(false));
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

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
