import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip';

describe('чип', () => {
  it('should show its content', () => {
    render(<Chip>Борис</Chip>);

    expect(screen.getByText('Борис')).toBeInTheDocument();
  });

  it('should have no button when there is nothing to remove', () => {
    render(<Chip>Борис</Chip>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should remove on click', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();

    render(
      <Chip onRemove={onRemove} removeLabel="Убрать Бориса">
        Борис
      </Chip>
    );
    await user.click(screen.getByRole('button', { name: 'Убрать Бориса' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('should be removable from the keyboard', async () => {
    /* Крестик — настоящая button, а не icon: иначе участника с
       клавиатуры не убрать вовсе. */
    const onRemove = vi.fn();
    const user = userEvent.setup();

    render(
      <Chip onRemove={onRemove} removeLabel="Убрать Бориса">
        Борис
      </Chip>
    );
    await user.tab();

    expect(screen.getByRole('button', { name: 'Убрать Бориса' })).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('should cut a long name instead of stretching the row', () => {
    render(<Chip>Константин Константинопольский</Chip>);

    expect(screen.getByText('Константин Константинопольский')).toHaveClass('truncate');
  });
});
