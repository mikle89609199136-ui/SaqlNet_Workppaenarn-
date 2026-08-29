import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  const options = [
    { label: 'Все', value: 'all' },
    { label: 'Личные', value: 'personal' },
    { label: 'Работа', value: 'work', disabled: true },
  ];

  it('renders options correctly', () => {
    render(<SegmentedControl value="all" onChange={() => {}} options={options} />);
    
    expect(screen.getByRole('button', { name: 'Все' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Личные' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Работа' })).toBeInTheDocument();
  });

  it('marks active option with aria-pressed', () => {
    render(<SegmentedControl value="personal" onChange={() => {}} options={options} />);
    
    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Личные' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onChange when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<SegmentedControl value="all" onChange={onChange} options={options} />);
    
    await user.click(screen.getByRole('button', { name: 'Личные' }));
    
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('personal');
  });

  it('does not call onChange when disabled option is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<SegmentedControl value="all" onChange={onChange} options={options} />);
    
    const disabledBtn = screen.getByRole('button', { name: 'Работа' });
    expect(disabledBtn).toBeDisabled();
    
    await user.click(disabledBtn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
