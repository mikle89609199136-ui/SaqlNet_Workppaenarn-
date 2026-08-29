import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('переключатель', () => {
  it('should introduce itself as a switch, not a checkbox', () => {
    /* Флажок — это выбор в форме, которую ещё надо отправить, а
       переключатель применяется сразу. Назовёт флажком — человек будет
       ждать кнопки «Сохранить», которой нет. */
    render(<Switch label="Уведомления" />);

    expect(screen.getByRole('switch', { name: 'Уведомления' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('should report whether it is on', async () => {
    const user = userEvent.setup();

    render(<Switch label="Звук" />);

    const переключатель = screen.getByRole('switch', { name: 'Звук' });

    expect(переключатель).not.toBeChecked();

    await user.click(переключатель);

    expect(переключатель).toBeChecked();
  });

  it('should toggle when the label is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Switch label="Звук" onChange={onChange} />);
    await user.click(screen.getByText('Звук'));

    expect(onChange).toHaveBeenCalled();
  });

  it('should toggle from the keyboard', async () => {
    const user = userEvent.setup();

    render(<Switch label="Звук" />);
    await user.tab();

    expect(screen.getByRole('switch', { name: 'Звук' })).toHaveFocus();

    await user.keyboard(' ');

    expect(screen.getByRole('switch', { name: 'Звук' })).toBeChecked();
  });

  it('should stay put when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Switch disabled label="Звук" onChange={onChange} />);
    await user.click(screen.getByRole('switch', { name: 'Звук' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should work controlled', async () => {
    const user = userEvent.setup();

    function Настройка() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} label="Звук" onChange={(event) => setOn(event.target.checked)} />;
    }

    render(<Настройка />);
    await user.click(screen.getByRole('switch', { name: 'Звук' }));

    expect(screen.getByRole('switch', { name: 'Звук' })).toBeChecked();
  });

  it('should let the reader find the hint', () => {
    render(<Switch hint="Придут на все чаты" label="Уведомления" />);

    expect(screen.getByRole('switch', { name: 'Уведомления' })).toHaveAccessibleDescription(
      'Придут на все чаты'
    );
  });

  it('should announce an error the moment it appears', () => {
    const { rerender } = render(<Switch label="Звук" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<Switch error="Не удалось сохранить" label="Звук" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить');
  });

  it('should hand its element over through a ref', () => {
    const ref = createRef<HTMLInputElement>();

    render(<Switch label="Звук" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
