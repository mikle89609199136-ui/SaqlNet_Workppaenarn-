import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RateLimitPage } from './RateLimitPage.jsx';

describe('RateLimitPage', () => {
  it('enables the back button when the countdown finishes', async () => {
    vi.useFakeTimers();
    const onBack = vi.fn();

    render(<RateLimitPage retryAfter={1} onBack={onBack} />);

    const button = screen.getByRole('button', { name: /вернуться назад/i });
    expect(button).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onBack).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});
