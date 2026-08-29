import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './Textarea';

describe('многострочное поле', () => {
  it('should take its name from the label', () => {
    render(<Textarea label="Описание группы" />);

    expect(screen.getByRole('textbox', { name: 'Описание группы' })).toBeInTheDocument();
  });

  it('should open about three lines tall', () => {
    render(<Textarea label="Описание" />);

    expect(screen.getByRole('textbox', { name: 'Описание' })).toHaveAttribute('rows', '3');
  });

  it('should only be draggable downwards', () => {
    /* Вбок растягивать некуда — область и так во всю ширину, а рывок
       вширь ломает раскладку. */
    render(<Textarea label="Описание" />);

    expect(screen.getByRole('textbox', { name: 'Описание' })).toHaveClass('resize-y');
  });

  it('should count what is typed', async () => {
    const user = userEvent.setup();

    render(<Textarea label="Описание" maxLength={255} />);
    await user.type(screen.getByRole('textbox', { name: 'Описание' }), 'Собираемся');

    expect(screen.getByText('10 / 255')).toBeInTheDocument();
  });

  it('should count in a controlled field too', async () => {
    const user = userEvent.setup();

    function Форма() {
      const [text, setText] = useState('Привет');
      return (
        <Textarea
          label="Описание"
          maxLength={255}
          onChange={(event) => setText(event.target.value)}
          value={text}
        />
      );
    }

    render(<Форма />);

    expect(screen.getByText('6 / 255')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Описание' }), '!');

    expect(screen.getByText('7 / 255')).toBeInTheDocument();
  });

  it('should tell the reader about the limit without repeating it on every keystroke', () => {
    /* Счётчик попадает в описание поля, а не в живую область: предел
       звучит один раз при фокусе. */
    render(<Textarea label="Описание" maxLength={255} />);

    expect(screen.getByRole('textbox', { name: 'Описание' })).toHaveAccessibleDescription(
      /0 \/ 255/
    );
  });

  it('should let the hint and the counter live together', () => {
    render(<Textarea hint="Расскажите о группе" label="Описание" maxLength={255} />);

    expect(screen.getByRole('textbox', { name: 'Описание' })).toHaveAccessibleDescription(
      'Расскажите о группе 0 / 255'
    );
  });

  it('should mark itself invalid and announce the error', () => {
    render(<Textarea error="Слишком длинно" label="Описание" />);

    const поле = screen.getByRole('textbox', { name: 'Описание' });

    expect(поле).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком длинно');
  });

  it('should hand its element over through a ref', () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(<Textarea label="Описание" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('should put the caller className on the outside', () => {
    const { container } = render(<Textarea className="w-40" label="Описание" />);

    expect(container.firstChild).toHaveClass('w-40');
  });
});
