import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage.jsx';

describe('RegisterPage', () => {
  it('moves through the registration steps and validates credentials', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.click(screen.getAllByRole('button', { name: /создать аккаунт/i })[0]);
    expect(screen.getByRole('textbox', { name: /имя/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /продолжить/i }));
    expect(screen.getByText(/введите имя/i)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /имя/i }), 'Ivan');
    await user.click(screen.getByRole('button', { name: /продолжить/i }));

    expect(screen.getByRole('textbox', { name: /юзернейм/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /создать аккаунт/i }));
    expect(screen.getByText(/юзернейм: минимум 3 символа/i)).toBeInTheDocument();
  });

  it('submits valid registration data', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({
        token: 'token',
        user: { firstName: 'Ivan', id: '1', username: 'ivan_1' },
      }),
      ok: true,
    });

    render(<RegisterPage />);
    await user.click(screen.getAllByRole('button', { name: /создать аккаунт/i })[0]);
    await user.type(screen.getByRole('textbox', { name: /имя/i }), 'Ivan');
    await user.click(screen.getByRole('button', { name: /продолжить/i }));
    await user.type(screen.getByRole('textbox', { name: /юзернейм/i }), 'ivan_1');
    await user.type(screen.getByLabelText(/^пароль$/i), 'Password10');
    await user.type(screen.getByLabelText(/повторите пароль/i), 'Password10');
    await user.click(screen.getAllByRole('button', { name: /создать аккаунт/i }).at(-1));

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v2/auth/register'), expect.objectContaining({ method: 'POST' }));
    fetchMock.mockRestore();
  });
});
