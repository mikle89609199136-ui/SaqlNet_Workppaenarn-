import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Radio } from './Radio';

describe('переключатель одного из нескольких', () => {
  it('should take its name from the label', () => {
    render(<Radio label="Светлая" name="theme" />);

    expect(screen.getByRole('radio', { name: 'Светлая' })).toBeInTheDocument();
  });

  it('should select when the label is clicked', async () => {
    const user = userEvent.setup();

    render(<Radio label="Светлая" name="theme" />);
    await user.click(screen.getByText('Светлая'));

    expect(screen.getByRole('radio', { name: 'Светлая' })).toBeChecked();
  });

  it('should not select when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Radio disabled label="Недоступна" name="theme" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Недоступна' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Недоступна' })).not.toBeChecked();
  });

  it('should stay dead inside a switched-off form', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <fieldset disabled>
        <Radio label="Светлая" name="theme" onChange={onChange} />
      </fieldset>
    );

    expect(screen.getByRole('radio', { name: 'Светлая' })).toBeDisabled();

    await user.click(screen.getByText('Светлая'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should let the reader find the hint', () => {
    render(<Radio hint="Подойдёт для дня" label="Светлая" name="theme" />);

    expect(screen.getByRole('radio', { name: 'Светлая' })).toHaveAccessibleDescription(
      'Подойдёт для дня'
    );
  });

  it('should announce an error the moment it appears', () => {
    const { rerender } = render(<Radio label="Светлая" name="theme" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<Radio error="Выберите тему" label="Светлая" name="theme" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Выберите тему');
    expect(screen.getByRole('radio')).toHaveAttribute('aria-invalid', 'true');
  });

  it('should hand its element over through a ref', () => {
    const ref = createRef<HTMLInputElement>();

    render(<Radio label="Светлая" name="theme" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
