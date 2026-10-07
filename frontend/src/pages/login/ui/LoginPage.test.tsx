import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderAuth } from '@/test/harness/renderAuth';

/**
 * Вход.
 *
 * Проверяется то, что видит человек: где показана ошибка, не пропало ли
 * введённое и куда его увели после успеха.
 */
describe('вход в аккаунт', () => {
  it('показывает ошибку у поля, а не только тостом', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json(
          { code: 'invalid_credentials', error: 'invalid username or password' },
          { status: 401 }
        )
      )
    );

    renderAuth();

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Неверное имя пользователя или пароль')).toBeInTheDocument();
  });

  it('не стирает введённое имя при неверном пароле', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({ code: 'invalid_credentials' }, { status: 401 })
      )
    );

    renderAuth();

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await screen.findByText('Неверное имя пользователя или пароль');
    // Ради этого ошибка и переехала к полям: набранное остаётся на месте.
    expect(screen.getByLabelText('Имя пользователя')).toHaveValue('tester');
  });

  it('не отправляет пустую форму на сервер', async () => {
    let requested = false;
    server.use(
      http.post(api('/auth/login'), () => {
        requested = true;
        return HttpResponse.json({});
      })
    );

    renderAuth();
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Введите имя пользователя')).toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('«@» в начале имени не мешает: оно уже стоит перед полем (#827)', async () => {
    let sentUsername: unknown;
    server.use(
      http.post(api('/auth/login'), async ({ request }) => {
        sentUsername = ((await request.json()) as { username: string }).username;
        return HttpResponse.json({ user: { id: 'user-1', username: 'tester' } });
      })
    );

    renderAuth();

    await userEvent.type(screen.getByLabelText('Имя пользователя'), '@tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(sentUsername).toBe('tester'));
  });

  it('после успешного входа уводит в чаты', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({ user: { id: 'user-1', username: 'tester' } })
      )
    );

    renderAuth();

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Список чатов')).toBeInTheDocument();
    expect(localStorage.getItem('craneapp_auth_token')).toBeNull();
  });

  it('возвращает туда, откуда выкинуло', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({ user: { id: 'user-1', username: 'tester' } })
      )
    );

    // Так адрес выглядит после того, как AuthGuard увёл с переписки.
    renderAuth({ path: '/login?from=%2Fchats%2Fchat-1' });

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Переписка')).toBeInTheDocument();
  });

  it('не уходит по чужой ссылке из адресной строки', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({ user: { id: 'user-1', username: 'tester' } })
      )
    );

    // `//evil.example` — это чужой сайт, а не внутренний путь.
    renderAuth({ path: '/login?from=%2F%2Fevil.example' });

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Список чатов')).toBeInTheDocument();
  });

  it('объясняет, почему не пускает аккаунт с дополнительным паролем', async () => {
    // Сервер отвечает 200 и просит второй пароль, а интерфейса для него
    // больше нет. Молчаливая форма здесь была бы тупиком.
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({ twoFARequired: true, userId: 'user-1' })
      )
    );

    renderAuth();

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'tester');
    await userEvent.type(screen.getByLabelText('Пароль'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText(/дополнительный пароль/i)).toBeInTheDocument();
  });

  it('показывает пароль по кнопке', async () => {
    renderAuth();

    const password = screen.getByLabelText('Пароль');
    expect(password).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Показать пароль' }));
    await waitFor(() => expect(password).toHaveAttribute('type', 'text'));
  });
});
