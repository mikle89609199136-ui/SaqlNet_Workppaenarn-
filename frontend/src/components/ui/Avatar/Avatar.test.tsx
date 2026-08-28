import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

const круг = (c: HTMLElement) => c.querySelector('span > span') as HTMLElement;

describe('аватарка', () => {
  it('should show the photo when there is one', () => {
    const { container } = render(<Avatar name="Анна" src="/anna.jpg" />);

    expect(container.querySelector('img')).toHaveAttribute('src', '/anna.jpg');
    expect(container).not.toHaveTextContent('А');
  });

  it('should fall back to the first letter of the name', () => {
    const { container } = render(<Avatar id="u-anna" name="анна" />);

    expect(круг(container)).toHaveTextContent('А');
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
    expect(круг(container)).toHaveTextContent('Р');
  });

  it('should give the same person the same colour every time', () => {
    const первый = render(<Avatar id="u-boris" name="Борис" />);
    const второй = render(<Avatar id="u-boris" name="Борис" />);

    expect(круг(первый.container).className).toBe(круг(второй.container).className);
  });

  it('should tell people apart when their names start alike', () => {
    const анна = render(<Avatar id="u-anna" name="Анна" />);
    const антон = render(<Avatar id="u-anton" name="Антон" />);

    expect(круг(анна.container).className).not.toBe(круг(антон.container).className);
  });

  it('should not fall apart on an empty name', () => {
    const { container } = render(<Avatar />);

    expect(круг(container)).toHaveTextContent('?');
  });

  it('should stay decorative for assistive technology', () => {
    /* Аватарка всегда стоит рядом с именем: имя диктор прочитает сам,
       а «А на синем круге» ему сообщать незачем. */
    const { container } = render(<Avatar id="u-anna" name="Анна" online />);

    container.querySelectorAll('span > span').forEach((узел) => {
      expect(узел).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
