import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

describe('поле', () => {
  it('should take its name from the label', () => {
    render(<Input label="Название группы" />);

    expect(screen.getByRole('textbox', { name: 'Название группы' })).toBeInTheDocument();
  });

  it('should let the reader find the hint', () => {
    /* Подсказка бесполезна, если диктор её не прочитает вместе с полем. */
    render(<Input hint="До 50 знаков" label="Название" />);

    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveAccessibleDescription(
      'До 50 знаков'
    );
  });

  it('should mark itself invalid and read the error out', () => {
    render(<Input error="Юзернейм короче трёх знаков" label="Юзернейм" />);

    const поле = screen.getByRole('textbox', { name: 'Юзернейм' });

    expect(поле).toHaveAttribute('aria-invalid', 'true');
    expect(поле).toHaveAccessibleDescription('Юзернейм короче трёх знаков');
  });

  it('should show the error instead of the hint, not both', () => {
    render(<Input error="Слишком коротко" hint="До 50 знаков" label="Имя" />);

    expect(screen.getByText('Слишком коротко')).toBeInTheDocument();
    expect(screen.queryByText('До 50 знаков')).not.toBeInTheDocument();
  });

  it('should accept typing', async () => {
    const user = userEvent.setup();

    render(<Input label="Имя" />);
    await user.type(screen.getByRole('textbox', { name: 'Имя' }), 'Анна');

    expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveValue('Анна');
  });

  it('should refuse typing when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Input disabled label="Имя" onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: 'Имя' }), 'Анна');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should stay copyable when it is only for reading', () => {
    /* Только для чтения — не запрет: поле остаётся живым и в обходе табом. */
    render(<Input label="Юзернейм" readOnly value="@anna" />);

    const поле = screen.getByRole('textbox', { name: 'Юзернейм' });

    expect(поле).toHaveAttribute('readonly');
    expect(поле).not.toBeDisabled();
  });

  it('should keep one caption per field when several are on screen', () => {
    /* Два поля рядом не должны делить один id подписи, иначе диктор
       прочитает чужую. */
    render(
      <>
        <Input hint="Первая" label="Одно" />
        <Input hint="Вторая" label="Другое" />
      </>
    );

    expect(screen.getByRole('textbox', { name: 'Одно' })).toHaveAccessibleDescription('Первая');
    expect(screen.getByRole('textbox', { name: 'Другое' })).toHaveAccessibleDescription('Вторая');
  });
});
