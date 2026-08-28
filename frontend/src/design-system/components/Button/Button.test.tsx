import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('кнопка', () => {
  it('should pass the click through', async () => {
    const нажали = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={нажали}>Отправить</Button>);
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(нажали).toHaveBeenCalledTimes(1);
  });

  it('should not pass the click through when disabled', async () => {
    const нажали = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={нажали}>
        Отправить
      </Button>
    );
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(нажали).not.toHaveBeenCalled();
  });

  it('should not pass the click through while loading', async () => {
    // Про этот случай забывают чаще всего, а стоит он дорого: пока идёт
    // запрос, кнопка выглядит обычной, и второе нажатие отправляет форму
    // повторно.
    const нажали = vi.fn();
    const user = userEvent.setup();

    render(
      <Button loading onClick={нажали}>
        Отправить
      </Button>
    );
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(нажали).not.toHaveBeenCalled();
  });

  it('should keep its accessible name while loading', () => {
    // Текст обязан остаться: без него кнопка прыгает по ширине, а читалка
    // называет её просто «кнопка».
    render(<Button loading>Отправить</Button>);

    expect(screen.getByRole('button', { name: 'Отправить' })).toHaveAttribute('aria-busy', 'true');
  });

  it('should let the caller override the base class', () => {
    // Базовые классы не должны залипать: иначе вызывающему негде поправить
    // ширину или отступ под конкретное место.
    render(<Button className="w-full">Отправить</Button>);

    expect(screen.getByRole('button')).toHaveClass('w-full');
  });

  it('should stay submittable inside a form', async () => {
    // type по умолчанию button, чтобы кнопка случайно не отправляла форму.
    // Но когда это нужно, вызывающий должен иметь возможность сказать.
    const отправили = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();

    render(
      <form onSubmit={отправили}>
        <Button type="submit">Войти</Button>
      </form>
    );
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(отправили).toHaveBeenCalledTimes(1);
  });
});
