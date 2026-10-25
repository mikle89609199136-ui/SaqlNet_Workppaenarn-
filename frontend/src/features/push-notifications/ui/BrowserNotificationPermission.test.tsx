import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BrowserNotificationPermission } from './BrowserNotificationPermission';

describe('разрешение browser fallback', () => {
  it.each(['granted', 'default', 'denied'] as const)(
    'запрашивает только по нажатию; результат %s',
    async (result) => {
      const requestPermission = vi.fn().mockResolvedValue(result);
      vi.stubGlobal('Notification', { permission: 'default', requestPermission });
      render(<BrowserNotificationPermission />);
      expect(requestPermission).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Разрешить' }));
      expect(requestPermission).toHaveBeenCalledOnce();
      if (result !== 'default')
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Разрешить' })).not.toBeInTheDocument()
        );
      else
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'Разрешить' })).toBeEnabled()
        );
    }
  );
  it('при denied не предлагает повторный запрос', () => {
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission });
    render(<BrowserNotificationPermission />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Запрещены браузером/)).toBeInTheDocument();
  });
});
