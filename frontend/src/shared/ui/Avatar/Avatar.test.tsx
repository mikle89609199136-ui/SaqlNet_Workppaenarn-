import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

const circle = (c: HTMLElement) => c.querySelector('span > span') as HTMLElement;

describe('аватарка', () => {
  it('should show the photo when there is one', () => {
    const { container } = render(<Avatar name="Анна" src="/anna.jpg" />);

    expect(container.querySelector('img')).toHaveAttribute('src', '/anna.jpg');
    expect(container).not.toHaveTextContent('А');
  });

  it('should fall back to the first letter of the name', () => {
    const { container } = render(<Avatar id="u-anna" name="анна" />);

    expect(circle(container)).toHaveTextContent('А');
  });

  it('should draw a grid when asked and there is an id', () => {
    const { container } = render(<Avatar id="u-anna" name="Анна" shape="grid" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('А');
  });

  it('should keep the letter for a group even in grid mode', () => {
    /* Сетку рисовать не от чего: у групп и каналов нет peerId. */
    const { container } = render(<Avatar name="Рабочий чат" shape="grid" />);

    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(circle(container)).toHaveTextContent('Р');
  });

  it('should give the same person the same colour every time', () => {
    const first = render(<Avatar id="u-boris" name="Борис" />);
    const second = render(<Avatar id="u-boris" name="Борис" />);

    expect(circle(first.container).className).toBe(circle(second.container).className);
  });

  it('should tell people apart when their names start alike', () => {
    const anna = render(<Avatar id="u-anna" name="Анна" />);
    const anton = render(<Avatar id="u-anton" name="Антон" />);

    expect(circle(anna.container).className).not.toBe(circle(anton.container).className);
  });

  it('should not fall apart on an empty name', () => {
    const { container } = render(<Avatar />);

    expect(circle(container)).toHaveTextContent('?');
  });

  it('should stay decorative for assistive technology', () => {
    /* Аватарка всегда стоит рядом с именем: имя диктор прочитает сам,
       а «А на синем круге» ему сообщать незачем. */
    const { container } = render(<Avatar id="u-anna" name="Анна" online />);

    container.querySelectorAll('span > span').forEach((node) => {
      expect(node).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('точка «в сети» в строке списка — зелёный круг 12 и обводка 2 снаружи, как в макете', () => {
    /* В макете у точки нет box-sizing: обводка добавляется снаружи, всего
       16px. С border-box при 12px зелёного оставалось 8 — точка выходила
       заметно мельче. */
    const { container } = render(<Avatar id="u-anna" name="Анна" online size="lg" />);

    const dot = container.querySelector('.bg-ok');
    expect(dot).toHaveClass('size-4', 'border-2', 'border-sheet');
  });
});
