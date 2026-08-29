import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio } from './Radio';

describe('Radio component', () => {
  it('should select when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Radio label="Option 1" name="opt" onChange={onChange} />);
    const radio = screen.getByRole('radio', { name: 'Option 1' });
    
    expect(radio).not.toBeChecked();
    await user.click(radio);
    
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(radio).toBeChecked();
  });

  it('should not toggle when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Radio label="Option 1" disabled onChange={onChange} />);
    const radio = screen.getByRole('radio', { name: 'Option 1' });

    expect(radio).toBeDisabled();
    await user.click(radio);
    
    expect(onChange).not.toHaveBeenCalled();
    expect(radio).not.toBeChecked();
  });

  it('should show hint and error properly', () => {
    const { rerender } = render(<Radio label="Option 1" hint="Please read" />);
    
    expect(screen.getByText('Please read')).toBeInTheDocument();
    
    rerender(<Radio label="Option 1" hint="Please read" error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
    expect(screen.queryByText('Please read')).not.toBeInTheDocument();
  });
});
