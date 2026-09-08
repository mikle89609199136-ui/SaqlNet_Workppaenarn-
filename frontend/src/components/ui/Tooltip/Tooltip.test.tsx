import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

function renderTooltip(content = 'Отправить · Enter') {
  return render(
    <Tooltip content={content}>
      <button type="button">Отправить</button>
    </Tooltip>
  );
}

describe('подсказка', () => {
  it('should describe the element it belongs to', () => {
    /* Это описание, а не имя: имя кнопке даёт её содержимое, а подсказка
       добавляет к нему горячую клавишу. */
    renderTooltip();

    const trigger = screen.getByRole('button', { name: 'Отправить' });

    expect(trigger).toHaveAccessibleDescription('Отправить · Enter');
  });

  it('should keep its text reachable for the reader at all times', () => {
    /* Спрятана она только для глаз — прозрачностью. Для диктора текст
       доступен всегда, потому и связан через aria-describedby. */
    renderTooltip();

    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Отправить · Enter');
  });

  it('should show up on keyboard focus', async () => {
    /* Появление только по наведению означает, что с клавиатуры подсказку
       не увидят вовсе. */
    const user = userEvent.setup();

    const { container } = renderTooltip();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Отправить' })).toHaveFocus();
    expect(container.firstChild).toHaveClass('group');
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveClass('group-focus-within:visible');
  });

  it('should not swallow the pointer', async () => {
    /* Иначе подсказка исчезает от собственного появления: курсор попадает
       на неё, уходит с кнопки, наведение теряется. */
    renderTooltip();

    expect(screen.getByRole('tooltip', { hidden: true })).toHaveClass('pointer-events-none');
  });

  it('should stand where it was asked to', () => {
    render(
      <Tooltip content="Прикрепить файл" position="bottom">
        <button type="button">Скрепка</button>
      </Tooltip>
    );

    expect(screen.getByRole('tooltip', { hidden: true })).toHaveClass('top-full');
  });

  it('should leave the trigger its own attributes', async () => {
    const user = userEvent.setup();
    let pressed = 0;

    render(
      <Tooltip content="Отправить · Enter">
        <button onClick={() => (pressed += 1)} type="button">
          Отправить
        </button>
      </Tooltip>
    );
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(pressed).toBe(1);
  });
});
