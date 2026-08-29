import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox component', () => {
  it('should toggle when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Checkbox label="Accept terms" onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' });
    
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(checkbox).toBeChecked();
  });

  it('should not toggle when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Checkbox label="Accept terms" disabled onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' });

    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    
    expect(onChange).not.toHaveBeenCalled();
    expect(checkbox).not.toBeChecked();
  });

  it('should show hint and error properly', () => {
    const { rerender } = render(<Checkbox label="Terms" hint="Please read" />);
    
    expect(screen.getByText('Please read')).toBeInTheDocument();
    
    rerender(<Checkbox label="Terms" hint="Please read" error="Required field" />);
    // Error displaces hint
    expect(screen.getByText('Required field')).toBeInTheDocument();
    expect(screen.queryByText('Please read')).not.toBeInTheDocument();
  });
});
