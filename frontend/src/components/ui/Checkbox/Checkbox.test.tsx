import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('флажок', () => {
  it('should take its name from the label', () => {
    render(<Checkbox label="Удалить у всех" />);

    expect(screen.getByRole('checkbox', { name: 'Удалить у всех' })).toBeInTheDocument();
  });

  it('should toggle when the label is clicked', async () => {
    /* Настоящий input скрыт, а виден квадрат рядом. Клик по подписи —
       единственный путь человека к этому флажку, и держится он на
       htmlFor: без него компонент нельзя нажать вовсе. */
    const user = userEvent.setup();

    render(<Checkbox label="Удалить у всех" />);
    await user.click(screen.getByText('Удалить у всех'));

    expect(screen.getByRole('checkbox', { name: 'Удалить у всех' })).toBeChecked();
  });

  it('should toggle from the keyboard', async () => {
    const user = userEvent.setup();

    render(<Checkbox label="Уведомлять" />);
    await user.tab();

    expect(screen.getByRole('checkbox', { name: 'Уведомлять' })).toHaveFocus();

    await user.keyboard(' ');

    expect(screen.getByRole('checkbox', { name: 'Уведомлять' })).toBeChecked();
  });

  it('should report the mixed state when only part is chosen', () => {
    /* Заголовок выбора нескольких сообщений: отмечены три из двенадцати.
       Без промежуточного он выглядел бы снятым, и нажатие отметило бы
       всё вместо снятия. */
    render(<Checkbox indeterminate label="Выбрано 3 из 12" />);

    const checkbox = screen.getByRole('checkbox', { name: 'Выбрано 3 из 12' });

    /* Свойство узла, а не атрибут: отсюда диктор и берёт «mixed». */
    expect(checkbox).toHaveProperty('indeterminate', true);
    expect(checkbox).not.toBeChecked();
  });

  it('should drop the mixed state when everything got chosen', () => {
    const { rerender } = render(
      <Checkbox checked={false} indeterminate label="Выбрано 3 из 12" onChange={vi.fn()} />
    );

    rerender(
      <Checkbox checked indeterminate={false} label="Выбрано 12 из 12" onChange={vi.fn()} />
    );

    expect(screen.getByRole('checkbox')).toHaveProperty('indeterminate', false);
  });

  it('should not toggle when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Checkbox disabled label="Недоступно" onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Недоступно' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should stay dead inside a switched-off form', async () => {
    /* Форму выключают целиком через fieldset. Пока вид зависел от
       своего пропа, флажок оставался ярким и выглядел живым, хотя
       нажатие уже ничего не делало. Вид теперь читается с самого input
       правилом has-[:disabled] — jsdom его не считает, поэтому здесь
       проверяется само отключение. */
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <fieldset disabled>
        <Checkbox label="Внутри выключенной формы" onChange={onChange} />
      </fieldset>
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Внутри выключенной формы' });

    expect(checkbox).toBeDisabled();

    await user.click(screen.getByText('Внутри выключенной формы'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should let the reader find the hint', () => {
    render(<Checkbox hint="Сообщение исчезнет у всех" label="Удалить у всех" />);

    expect(screen.getByRole('checkbox', { name: 'Удалить у всех' })).toHaveAccessibleDescription(
      'Сообщение исчезнет у всех'
    );
  });

  it('should announce an error the moment it appears', () => {
    const { rerender } = render(<Checkbox label="Условия" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<Checkbox error="Нужно согласиться" label="Условия" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Нужно согласиться');
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('should show the error instead of the hint, not both', () => {
    render(<Checkbox error="Нужно согласиться" hint="Прочитайте условия" label="Условия" />);

    expect(screen.getByText('Нужно согласиться')).toBeInTheDocument();
    expect(screen.queryByText('Прочитайте условия')).not.toBeInTheDocument();
  });

  it('should work controlled', async () => {
    const user = userEvent.setup();

    function Form() {
      const [on, setOn] = useState(false);
      return (
        <Checkbox
          checked={on}
          label="Уведомлять"
          onChange={(event) => setOn(event.target.checked)}
        />
      );
    }

    render(<Form />);
    await user.click(screen.getByRole('checkbox', { name: 'Уведомлять' }));

    expect(screen.getByRole('checkbox', { name: 'Уведомлять' })).toBeChecked();
  });

  it('should hand its element over through a ref', () => {
    const ref = createRef<HTMLInputElement>();

    render(<Checkbox label="Уведомлять" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
