import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from './Banner';

describe('плашка', () => {
  it('should show its message', () => {
    render(<Banner>Сообщения в этом чате защищены сквозным шифрованием</Banner>);

    expect(
      screen.getByText('Сообщения в этом чате защищены сквозным шифрованием')
    ).toBeInTheDocument();
  });

  it('should interrupt the reader when it is dangerous', () => {
    /* Подпись не совпала — это про подмену отправителя, такое человек
       обязан услышать сразу, а не когда доберётся до плашки сам. */
    render(<Banner tone="danger">Подпись не совпала</Banner>);

    expect(screen.getByRole('alert')).toHaveTextContent('Подпись не совпала');
  });

  it('should wait its turn when it is not', () => {
    render(<Banner tone="info">Сообщения защищены</Banner>);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should keep a warning out of the way of speech too', () => {
    render(<Banner tone="warn">Код безопасности изменился</Banner>);

    expect(screen.getByRole('status')).toHaveTextContent('Код безопасности изменился');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should hide the icon from the reader', () => {
    /* Значок повторяет то, что уже сказано текстом: читать его вслух
       незачем, иначе диктор объявит «изображение» перед каждой плашкой. */
    const { container } = render(<Banner tone="warn">Код изменился</Banner>);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('should take the icon the caller asked for', () => {
    const { container } = render(
      <Banner icon="pin" tone="info">
        Закреплено
      </Banner>
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('should hold an action next to the message', () => {
    const onClick = vi.fn();

    render(
      <Banner action={<button onClick={onClick}>Понятно</button>} tone="warn">
        Код безопасности изменился
      </Banner>
    );

    expect(screen.getByRole('button', { name: 'Понятно' })).toBeInTheDocument();
  });

  it('should let the action be pressed', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Banner action={<button onClick={onClick}>Понятно</button>} tone="warn">
        Код изменился
      </Banner>
    );
    await user.click(screen.getByRole('button', { name: 'Понятно' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should put the caller className on the outside', () => {
    const { container } = render(<Banner className="mt-4">Текст</Banner>);

    expect(container.firstChild).toHaveClass('mt-4');
  });
});
