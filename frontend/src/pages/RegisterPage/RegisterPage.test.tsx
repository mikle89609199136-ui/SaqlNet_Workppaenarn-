import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderAuth } from '@/test/harness/renderAuth';

/* Пройти до шага с именем пользователя: приветствие, затем имя. */
async function goToCredentials(name = 'Максим') {
  await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
  await userEvent.type(screen.getByLabelText('Имя'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
}

describe('регистрация', () => {
  it('не пускает дальше с пустым именем', async () => {
    renderAuth({ page: 'register' });

    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));

    expect(await screen.findByText('Введите имя')).toBeInTheDocument();
    // Остались на том же шаге: поле имени никуда не делось.
    expect(screen.getByLabelText('Имя')).toBeInTheDocument();
  });

  it('сохраняет введённое при возврате назад', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials('Максим');
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');

    await userEvent.click(screen.getByRole('button', { name: 'Назад' }));
    // Ради этого форма одна на все шаги: имя пережило переход.
    expect(screen.getByLabelText('Имя')).toHaveValue('Максим');

    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.getByLabelText('Имя пользователя')).toHaveValue('maximdon');
  });

  it('не ругается на поля, до которых человек не дошёл', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    // Набрали только пароль — про пустые имя пользователя и повтор пока
    // молчим: схема проверяет объект целиком, но человек их не касался.
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456');

    // Проверяем по признаку ошибки у поля, а не по тексту: «Повторите
    // пароль» — это ещё и подпись, она на экране в любом случае.
    expect(screen.getByLabelText('Имя пользователя')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Повторите пароль')).not.toHaveAttribute('aria-invalid');
  });

  it('проверяет имя пользователя по формату', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'мак сим');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Только латинские буквы, цифры и _')).toBeInTheDocument();
  });

  it('не даёт зарегистрироваться с разными паролями', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol654321');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument();
  });

  it('занятое имя показывает у своего поля', async () => {
    server.use(
      http.post(api('/auth/register'), () =>
        HttpResponse.json({ code: 'username_taken', error: 'username taken' }, { status: 409 })
      )
    );

    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Это имя пользователя занято')).toBeInTheDocument();
    // И человек остался на шаге, где это поле есть.
    expect(screen.getByLabelText('Имя пользователя')).toHaveValue('maximdon');
  });

  it('после успеха уводит в чаты', async () => {
    server.use(
      http.post(api('/auth/register'), () =>
        HttpResponse.json({ token: 'token-1', user: { id: 'user-1', username: 'maximdon' } })
      )
    );

    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Список чатов')).toBeInTheDocument();
  });

  it('отправляет имя и имя пользователя без лишних пробелов', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(api('/auth/register'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ token: 'token-1', user: { id: 'user-1' } });
      })
    );

    renderAuth({ page: 'register' });

    await goToCredentials('  Максим  ');
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await screen.findByText('Список чатов');
    expect(body.firstName).toBe('Максим');
    expect(body.username).toBe('maximdon');
  });
});
