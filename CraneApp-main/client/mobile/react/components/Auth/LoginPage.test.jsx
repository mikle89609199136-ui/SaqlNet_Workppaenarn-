import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage.jsx';

describe('LoginPage', () => {
  it('validates required credentials', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByRole('textbox', { name: /юзернейм/i }), 'ivan_1');
    await user.click(screen.getByRole('button', { name: /^войти$/i }));

    expect(screen.getByText(/введите юзернейм и пароль/i)).toBeInTheDocument();
  });

  it('stores auth data after successful login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ip: '127.0.0.1' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          token: 'token',
          user: { firstName: 'Ivan', id: '1', username: 'ivan_1' },
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ settings: { language: 'ru', notifications: false, sounds: true, theme: 'dark' } }),
        ok: true,
      });

    render(<LoginPage />);

    await user.type(screen.getByRole('textbox', { name: /юзернейм/i }), 'ivan_1');
    await user.type(screen.getByLabelText(/^пароль$/i), 'Password10');
    await user.click(screen.getByRole('button', { name: /^войти$/i }));

    await waitFor(() => {
      expect(localStorage.getItem('craneapp_auth_token')).toBe('token');
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/v2/auth/login'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(localStorage.getItem('craneapp_user_data'))).toEqual(expect.objectContaining({ username: 'ivan_1' }));
    fetchMock.mockRestore();
  });
});
