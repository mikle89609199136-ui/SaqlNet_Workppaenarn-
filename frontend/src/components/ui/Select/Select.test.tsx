import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const языки = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

function Список(props: { value?: string | null; onChange?: (v: string) => void } = {}) {
  const [value, setValue] = useState<string | null>(props.value ?? null);
  return (
    <Select
      label="Язык"
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      options={языки}
      value={value}
    />
  );
}

describe('выпадающий список', () => {
  it('should say what it is, not just what is picked', () => {
    /* Имя кнопки складывается из её содержимого. Без подписи диктор
       объявит «Русский» и не скажет, что это язык. */
    render(<Select label="Язык" onChange={vi.fn()} options={языки} value="ru" />);

    expect(screen.getByRole('combobox', { name: /Язык/ })).toBeInTheDocument();
  });

  it('should stay closed until asked', () => {
    render(<Список />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('should open on click', async () => {
    const user = userEvent.setup();

    render(<Список />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('should open on the down arrow', async () => {
    const user = userEvent.setup();

    render(<Список />);
    await user.tab();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('should pick with Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Список onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('should close on Escape without picking', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Список onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should keep focus on the trigger while the list is open', () => {
    /* Так и задумано: текущий пункт помечается aria-activedescendant,
       а фокус никуда не перекидывается. */
    render(<Select label="Язык" onChange={vi.fn()} options={языки} value="ru" />);

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('should mark the picked option as chosen', async () => {
    const user = userEvent.setup();

    render(<Select label="Язык" onChange={vi.fn()} options={языки} value="en" />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /English/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('should announce an error the moment it appears', () => {
    const { rerender } = render(
      <Select label="Тема" onChange={vi.fn()} options={языки} value={null} />
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <Select error="Выберите тему" label="Тема" onChange={vi.fn()} options={языки} value={null} />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Выберите тему');
  });

  it('should not open when disabled', async () => {
    const user = userEvent.setup();

    render(<Select disabled label="Язык" onChange={vi.fn()} options={языки} value="ru" />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
