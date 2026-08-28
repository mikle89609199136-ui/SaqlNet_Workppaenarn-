import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('спиннер', () => {
  it('should stay hidden from assistive technology when it has no label', () => {
    const { container } = render(<Spinner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('should announce itself when a label is given', () => {
    render(<Spinner label="Загрузка чатов" />);

    expect(screen.getByRole('status')).toHaveTextContent('Загрузка чатов');
  });

  it('should carry the label as text, not as an attribute', () => {
    /* role=status объявляет содержимое области. Пустая область с одним
       лишь aria-label читается не всеми дикторами, поэтому подпись обязана
       быть текстом — скрытым визуально, но настоящим. */
    render(<Spinner label="Загрузка чатов" />);

    const текст = screen.getByText('Загрузка чатов');

    expect(текст).toHaveClass('sr-only');
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-label');
  });

  it('should not be announced twice inside a button', () => {
    render(
      <button type="button" aria-busy>
        <Spinner tone="current" /> Сохранение
      </button>
    );

    expect(screen.getByRole('button', { name: 'Сохранение' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should keep the caller className', () => {
    const { container } = render(<Spinner className="mx-auto" />);

    expect(container.firstChild).toHaveClass('mx-auto');
  });

  it('should stop spinning when the viewer asked for less motion', () => {
    const { container } = render(<Spinner />);

    expect(container.firstChild).toHaveClass('motion-reduce:animate-none');
  });
});
