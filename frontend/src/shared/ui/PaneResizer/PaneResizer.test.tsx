import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaneResizer } from './PaneResizer';

function renderResizer(overrides: Partial<Parameters<typeof PaneResizer>[0]> = {}) {
  const props = {
    label: 'Изменить ширину списка чатов',
    width: 360,
    min: 280,
    max: 520,
    onNudge: vi.fn(),
    onJump: vi.fn(),
    onPointerDown: vi.fn(),
    ...overrides,
  };

  render(<PaneResizer {...props} />);
  return props;
}

describe('разделитель колонок', () => {
  it('доступен с клавиатуры и объявляет свои границы', () => {
    renderResizer();

    const separator = screen.getByRole('separator');
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('aria-valuenow', '360');
    expect(separator).toHaveAttribute('aria-valuemin', '280');
    expect(separator).toHaveAttribute('aria-valuemax', '520');
  });

  it('двигает границу стрелками', async () => {
    const props = renderResizer();
    const separator = screen.getByRole('separator');

    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowLeft}');

    expect(props.onNudge).toHaveBeenNthCalledWith(1, 16);
    expect(props.onNudge).toHaveBeenNthCalledWith(2, -16);
  });

  it('отправляет к краям по Home и End', async () => {
    const props = renderResizer();
    const separator = screen.getByRole('separator');

    separator.focus();
    await userEvent.keyboard('{Home}');
    await userEvent.keyboard('{End}');

    expect(props.onJump).toHaveBeenNthCalledWith(1, 'min');
    expect(props.onJump).toHaveBeenNthCalledWith(2, 'max');
  });

  it('не мешает остальным клавишам', async () => {
    const props = renderResizer();
    const separator = screen.getByRole('separator');

    separator.focus();
    await userEvent.keyboard('{Enter}');

    expect(props.onNudge).not.toHaveBeenCalled();
    expect(props.onJump).not.toHaveBeenCalled();
  });
});
