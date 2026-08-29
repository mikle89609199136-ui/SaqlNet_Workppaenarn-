import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders trigger and connects aria-describedby', () => {
    render(
      <Tooltip content="Отправить · Enter">
        <button aria-label="Отправить" data-testid="trigger">
          Send
        </button>
      </Tooltip>
    );

    const trigger = screen.getByTestId('trigger');
    expect(trigger).toBeInTheDocument();
    
    const tooltipId = trigger.getAttribute('aria-describedby');
    expect(tooltipId).toBeTruthy();

    // Since we use CSS to hide it (opacity-0 invisible), the element is still in the DOM
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveAttribute('id', tooltipId);
    expect(tooltip).toHaveTextContent('Отправить · Enter');
  });
});
