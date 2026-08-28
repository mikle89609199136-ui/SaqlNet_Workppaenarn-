import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonStyles } from './Button';

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

  it('should show only the spinner when an icon button is loading', () => {
    render(
      <Button iconOnly loading aria-label="Отправить">
        <span data-testid="значок">✈</span>
      </Button>
    );

    expect(screen.queryByTestId('значок')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toHaveAttribute('aria-busy', 'true');
  });

  it('should keep showing its children when a normal button is loading', () => {
    render(<Button loading>Сохранить</Button>);

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('should stay focusable while loading', async () => {
    /* Нативный disabled сбрасывает фокус на body и убирает кнопку из
       обхода табом: нажавший Enter теряет место, а aria-busy объявить
       некому. Поэтому во время загрузки — aria-disabled. */
    const { rerender } = render(<Button>Отправить</Button>);
    const кнопка = screen.getByRole('button', { name: 'Отправить' });
    кнопка.focus();

    rerender(<Button loading>Отправить</Button>);

    expect(кнопка).toHaveFocus();
    expect(кнопка).not.toBeDisabled();
    expect(кнопка).toHaveAttribute('aria-disabled', 'true');
  });

  it('should not submit a form while loading', async () => {
    const отправили = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();

    render(
      <form onSubmit={отправили}>
        <Button type="submit" loading>
          Сохранить
        </Button>
      </form>
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(отправили).not.toHaveBeenCalled();
  });

  it('should hand its styles to anything that is not a button', () => {
    render(
      <a href="/chats" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
        Перейти в чат
      </a>
    );

    const ссылка = screen.getByRole('link', { name: 'Перейти в чат' });

    expect(ссылка).toHaveClass('bg-sheet-2', 'text-caption');
  });

  it('should keep the font size of every size', () => {
    /* tailwind-merge считал text-caption цветом и выбрасывал его как
       проигравший спор с text-ink. Размер шрифта у кнопки пропадал
       молча — до появления этой проверки. */
    render(
      <>
        <Button size="sm">Мелкая</Button>
        <Button size="md">Обычная</Button>
        <Button size="lg">Крупная</Button>
      </>
    );

    expect(screen.getByRole('button', { name: 'Мелкая' })).toHaveClass('text-caption');
    expect(screen.getByRole('button', { name: 'Обычная' })).toHaveClass('text-body');
    expect(screen.getByRole('button', { name: 'Крупная' })).toHaveClass('text-title');
  });
});
