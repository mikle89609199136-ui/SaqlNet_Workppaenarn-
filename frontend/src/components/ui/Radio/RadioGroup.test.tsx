import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './RadioGroup';

const THEMES = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Системная' },
];

describe('группа переключателей', () => {
  it('should keep exactly one option chosen', async () => {
    /* Ровно то, ради чего группа и заведена: поодиночке переключатели
       отмечаются оба разом, потому что делить им нечего. */
    const user = userEvent.setup();

    render(<RadioGroup name="theme" options={THEMES} />);
    await user.click(screen.getByRole('radio', { name: 'Светлая' }));
    await user.click(screen.getByRole('radio', { name: 'Тёмная' }));

    expect(screen.getByRole('radio', { name: 'Тёмная' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Светлая' })).not.toBeChecked();
  });

  it('should give every option the same name', () => {
    /* Общее имя — это и есть договор с браузером: он сам следит за
       единственностью выбора и сам водит по группе стрелками. */
    render(<RadioGroup name="theme" options={THEMES} />);

    const names = screen.getAllByRole('radio').map((radio) => radio.getAttribute('name'));

    expect(new Set(names)).toEqual(new Set(['theme']));
  });

  it('should tell the reader what the group is about', () => {
    render(<RadioGroup label="Оформление" name="theme" options={THEMES} />);

    expect(screen.getByRole('group', { name: /Оформление/ })).toBeInTheDocument();
  });

  it('should announce one error for the whole group', () => {
    const { rerender } = render(<RadioGroup label="Оформление" name="theme" options={THEMES} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<RadioGroup error="Выберите тему" label="Оформление" name="theme" options={THEMES} />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите тему');
  });

  it('should switch every option off at once', () => {
    render(<RadioGroup disabled name="theme" options={THEMES} />);

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('should switch off a single option', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <RadioGroup
        name="theme"
        onChange={onChange}
        options={[...THEMES.slice(0, 2), { value: 'system', label: 'Системная', disabled: true }]}
      />
    );
    await user.click(screen.getByRole('radio', { name: 'Системная' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should work controlled', async () => {
    const user = userEvent.setup();

    function Settings() {
      const [theme, setTheme] = useState('light');
      return <RadioGroup name="theme" onChange={setTheme} options={THEMES} value={theme} />;
    }

    render(<Settings />);

    expect(screen.getByRole('radio', { name: 'Светлая' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Системная' }));

    expect(screen.getByRole('radio', { name: 'Системная' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Светлая' })).not.toBeChecked();
  });
});
