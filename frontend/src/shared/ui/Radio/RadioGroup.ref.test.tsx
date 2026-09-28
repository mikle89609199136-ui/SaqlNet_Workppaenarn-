import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Select } from '@/shared/ui/Select';
import { RadioGroup } from './RadioGroup';

/**
 * `ref` у этих двух нужен ради одного: увести фокус к полю с ошибкой.
 * Поэтому проверяется не наличие ссылки, а то, что `focus()` действительно
 * ставит фокус на то, чем можно управлять с клавиатуры.
 */
describe('фокус по ссылке', () => {
  it('группа переключателей отдаёт первый переключатель', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <RadioGroup
        name="visibility"
        options={[
          { value: 'all', label: 'Все' },
          { value: 'nobody', label: 'Никто' },
        ]}
        ref={ref}
      />
    );

    ref.current?.focus();

    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Все' }));
  });

  it('список выбора отдаёт кнопку, которая его открывает', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Select
        onChange={() => {}}
        options={[{ value: 'ru', label: 'Русский' }]}
        ref={ref}
        value="ru"
      />
    );

    ref.current?.focus();

    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });
});
