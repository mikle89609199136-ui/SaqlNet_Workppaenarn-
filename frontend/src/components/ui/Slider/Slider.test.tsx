import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Slider } from './Slider';

describe('Slider', () => {
  it('renders correctly with given value', () => {
    render(<Slider value={50} onChange={() => {}} aria-label="Volume" />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveValue('50');
  });

  it('calculates correct percentage', () => {
    render(<Slider value={5} min={0} max={10} onChange={() => {}} data-testid="slider" />);
    const slider = screen.getByTestId('slider');
    expect(slider).toHaveValue('5');
  });
});
