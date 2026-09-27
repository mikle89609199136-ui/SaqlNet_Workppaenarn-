import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { label: 'Все', value: 'all' },
  { label: 'Личные', value: 'personal' },
  { label: 'Работа', value: 'work', disabled: true },
];

describe('переключение разделов', () => {
  it('should show every option', () => {
    render(<SegmentedControl onChange={vi.fn()} options={OPTIONS} value="all" />);

    for (const option of OPTIONS) {
      expect(screen.getByRole('button', { name: option.label })).toBeInTheDocument();
    }
  });

  it('should mark the chosen one', () => {
    render(<SegmentedControl onChange={vi.fn()} options={OPTIONS} value="personal" />);

    expect(screen.getByRole('button', { name: 'Личные' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('should tell the chosen one apart by state, not by class', () => {
    /* Состояние живёт в data-*, иначе оно расползается по именам классов
       и разные экраны начинают называть его по-разному. */
    render(<SegmentedControl onChange={vi.fn()} options={OPTIONS} value="personal" />);

    expect(screen.getByRole('button', { name: 'Личные' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('data-state', 'inactive');
  });

  it('should report the option that was pressed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<SegmentedControl onChange={onChange} options={OPTIONS} value="all" />);
    await user.click(screen.getByRole('button', { name: 'Личные' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('personal');
  });

  it('should ignore a switched-off option', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<SegmentedControl onChange={onChange} options={OPTIONS} value="all" />);

    const disabled = screen.getByRole('button', { name: 'Работа' });

    expect(disabled).toBeDisabled();

    await user.click(disabled);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should be walkable from the keyboard', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<SegmentedControl onChange={onChange} options={OPTIONS} value="all" />);
    await user.tab();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Личные' })).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('personal');
  });

  it('should become tabs when asked, with a panel to name', () => {
    render(<SegmentedControl onChange={vi.fn()} options={OPTIONS} tabs="list" value="personal" />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tab = screen.getByRole('tab', { name: 'Личные' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('id', 'list-personal');
    expect(tab).toHaveAttribute('aria-controls', 'list-panel');
    // В вкладки табом попадают один раз — на выбранную.
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Все' })).toHaveAttribute('tabindex', '-1');
  });

  it('should skip a switched-off tab when walking with arrows', () => {
    const onChange = vi.fn();
    render(<SegmentedControl onChange={onChange} options={OPTIONS} tabs="list" value="personal" />);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Личные' }), { key: 'ArrowRight' });

    // «Работа» выключена — следующей идёт первая.
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('should hold the width when the choice moves', () => {
    /* Выбранный сегмент отличается фоном, а не весом: жирный текст шире,
       и полоса дёргалась бы при каждом переключении. */
    const { rerender } = render(
      <SegmentedControl onChange={vi.fn()} options={OPTIONS} value="all" />
    );

    const widthBefore = screen.getByRole('button', { name: 'Все' }).getBoundingClientRect().width;

    rerender(<SegmentedControl onChange={vi.fn()} options={OPTIONS} value="personal" />);

    expect(screen.getByRole('button', { name: 'Все' }).getBoundingClientRect().width).toBe(
      widthBefore
    );
  });
});
