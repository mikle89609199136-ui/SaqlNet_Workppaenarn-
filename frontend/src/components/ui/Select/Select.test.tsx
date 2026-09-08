import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

function LanguageSelect(props: { value?: string | null; onChange?: (v: string) => void } = {}) {
  const [value, setValue] = useState<string | null>(props.value ?? null);
  return (
    <Select
      label="Язык"
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      options={LANGUAGES}
      value={value}
    />
  );
}

describe('выпадающий список', () => {
  it('should say what it is, not just what is picked', () => {
    /* Имя кнопки складывается из её содержимого. Без подписи диктор
       объявит «Русский» и не скажет, что это язык. */
    render(<Select label="Язык" onChange={vi.fn()} options={LANGUAGES} value="ru" />);

    expect(screen.getByRole('combobox', { name: /Язык/ })).toBeInTheDocument();
  });

  it('should stay closed until asked', () => {
    render(<LanguageSelect />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('should open on click', async () => {
    const user = userEvent.setup();

    render(<LanguageSelect />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('should open on the down arrow', async () => {
    const user = userEvent.setup();

    render(<LanguageSelect />);
    await user.tab();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('should pick with Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<LanguageSelect onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('should close on Escape without picking', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<LanguageSelect onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should keep focus on the trigger while the list is open', () => {
    /* Так и задумано: текущий пункт помечается aria-activedescendant,
       а фокус никуда не перекидывается. */
    render(<Select label="Язык" onChange={vi.fn()} options={LANGUAGES} value="ru" />);

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('should mark the picked option as chosen', async () => {
    const user = userEvent.setup();

    render(<Select label="Язык" onChange={vi.fn()} options={LANGUAGES} value="en" />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /English/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('should announce an error the moment it appears', () => {
    const { rerender } = render(
      <Select label="Тема" onChange={vi.fn()} options={LANGUAGES} value={null} />
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <Select
        error="Выберите тему"
        label="Тема"
        onChange={vi.fn()}
        options={LANGUAGES}
        value={null}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Выберите тему');
  });

  it('should not open when disabled', async () => {
    const user = userEvent.setup();

    render(<Select disabled label="Язык" onChange={vi.fn()} options={LANGUAGES} value="ru" />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('should actually control the list it claims to control', () => {
    /* aria-controls ссылался на id, которого у списка не было вовсе —
       диктор не находил список, которым управляет кнопка. */
    render(<Select label="Язык" onChange={vi.fn()} options={LANGUAGES} value="ru" />);

    const trigger = screen.getByRole('combobox');
    const id = trigger.getAttribute('aria-controls');

    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toBeNull();
  });

  it('should give the open list a name', async () => {
    const user = userEvent.setup();

    render(<LanguageSelect />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('listbox', { name: 'Язык' })).toBeInTheDocument();
    expect(
      document.getElementById(screen.getByRole('combobox').getAttribute('aria-controls')!)
    ).toBe(screen.getByRole('listbox'));
  });

  it('should reach the first enabled option on Home', async () => {
    /* Раньше направление поиска выводилось из того, куда двинулись, и
       Home срывался, когда первый пункт отключён: поиск уходил за край. */
    const user = userEvent.setup();
    const withDisabled = [
      { value: 'x', label: 'Недоступен', disabled: true },
      { value: 'ru', label: 'Русский' },
      { value: 'en', label: 'English' },
    ];

    render(<Select label="Язык" onChange={vi.fn()} options={withDisabled} value="en" />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Home}');

    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toMatch(/-1$/);
  });

  it('should reach the last enabled option on End', async () => {
    const user = userEvent.setup();
    const withDisabled = [
      { value: 'ru', label: 'Русский' },
      { value: 'en', label: 'English' },
      { value: 'x', label: 'Недоступен', disabled: true },
    ];

    render(<Select label="Язык" onChange={vi.fn()} options={withDisabled} value="ru" />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{End}');

    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toMatch(/-1$/);
  });

  it('should step over a disabled option with the arrows', async () => {
    const user = userEvent.setup();
    const withGap = [
      { value: 'ru', label: 'Русский' },
      { value: 'x', label: 'Недоступен', disabled: true },
      { value: 'en', label: 'English' },
    ];
    const onChange = vi.fn();

    render(<Select label="Язык" onChange={onChange} options={withGap} value="ru" />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('en');
  });
});
