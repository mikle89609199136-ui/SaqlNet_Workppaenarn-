import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonStyles } from './Button';

describe('кнопка', () => {
  it('should pass the click through', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Отправить</Button>);
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should not pass the click through when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={onClick}>
        Отправить
      </Button>
    );
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('should not pass the click through while loading', async () => {
    // Про этот случай забывают чаще всего, а стоит он дорого: пока идёт
    // запрос, button выглядит обычной, и второе нажатие отправляет форму
    // повторно.
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button loading onClick={onClick}>
        Отправить
      </Button>
    );
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('should keep its accessible name while loading', () => {
    // Текст обязан остаться: без него button прыгает по ширине, а читалка
    // называет её просто «button».
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
    // type по умолчанию button, чтобы button случайно не отправляла форму.
    // Но когда это нужно, вызывающий должен иметь возможность сказать.
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Войти</Button>
      </form>
    );
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
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
    const button = screen.getByRole('button', { name: 'Отправить' });
    button.focus();

    rerender(<Button loading>Отправить</Button>);

    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('should not submit a form while loading', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Сохранить
        </Button>
      </form>
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should hand its styles to anything that is not a button', () => {
    render(
      <a href="/chats" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
        Перейти в чат
      </a>
    );

    const link = screen.getByRole('link', { name: 'Перейти в чат' });

    expect(link).toHaveClass('bg-sheet-2', 'text-caption');
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
  it('should replace the size radius when the shape is round', () => {
    /* Радиус приходит из размера, поэтому круглая форма обязана стоять
       после него: иначе tailwind-merge оставит rounded-control, и
       кнопка при иконке останется прямоугольной. */
    render(
      <Button aria-label="Позвонить" iconOnly shape="round" size="sm" variant="ghost">
        <span aria-hidden>+</span>
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Позвонить' });

    expect(button).toHaveClass('rounded-full');
    expect(button).not.toHaveClass('rounded-control');
  });

  it('should make the icon button a square of the design-system size', () => {
    render(
      <>
        <Button aria-label="Закрыть" iconOnly size="xs">
          <span aria-hidden>x</span>
        </Button>
        <Button aria-label="Вложение" iconOnly size="sm">
          <span aria-hidden>+</span>
        </Button>
      </>
    );

    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveClass('size-6');
    expect(screen.getByRole('button', { name: 'Вложение' })).toHaveClass('size-8');
  });

  it('should render the design-system icon button at 40 pixels by default', () => {
    render(
      <Button aria-label="Позвонить" iconOnly variant="ghost">
        <span aria-hidden>+</span>
      </Button>
    );

    expect(screen.getByRole('button', { name: 'Позвонить' })).toHaveClass(
      'size-10',
      'rounded-icon',
      'text-ink-2'
    );
  });

  it('should put the danger action on the soft danger background without a border', () => {
    /* Дизайн-система: опасное действие — на подложке danger-soft. Рамки
       нет ни у одного варианта: высоту держат отступы, а не бордюр. */
    render(<Button variant="danger">Удалить</Button>);

    const button = screen.getByRole('button', { name: 'Удалить' });

    expect(button).toHaveClass('bg-danger-soft', 'text-danger');
    expect(button.className.split(' ')).not.toContain('border');
  });

  it('should brighten a filled button on hover, as the design system does', () => {
    render(<Button variant="secondary">Сохранить</Button>);

    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveClass(
      'bg-sheet-2',
      'not-disabled:hover:brightness-108'
    );
  });

  it('should paint an icon button hover as a layer, keeping its pressed color', () => {
    /* Слой поверх фона, а не смена цвета: включённая кнопка-иконка при
       наведении остаётся цвета акцента. */
    render(
      <Button aria-label="Без звука" aria-pressed iconOnly variant="ghost">
        <span aria-hidden>🔕</span>
      </Button>
    );

    expect(screen.getByRole('button', { name: 'Без звука' })).toHaveClass(
      'hover:layer-hover',
      'aria-pressed:text-brand'
    );
  });

  it('should make the regular link-like action 44 pixels at 14px, as in the design system', () => {
    render(<Button variant="accent">Забыли пароль?</Button>);

    expect(screen.getByRole('button', { name: 'Забыли пароль?' })).toHaveClass('py-3', 'text-ui');
  });

  it('should color the link-like action with the accent', () => {
    render(<Button variant="accent">Забыли пароль?</Button>);

    expect(screen.getByRole('button', { name: 'Забыли пароль?' })).toHaveClass('text-brand');
  });
});
