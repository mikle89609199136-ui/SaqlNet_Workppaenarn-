import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH } from '@/shared/lib';
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

  it('называет в подсказке тот же минимум, что и список требований', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Пароль'), 'a');

    // Подсказка обещала шесть символов, а список требований под полем и
    // схема требовали десяти: человек видел два разных числа на одном
    // экране и не понимал, какому верить (#691).
    expect(screen.getByLabelText('Пароль')).toHaveAttribute(
      'placeholder',
      `Минимум ${MIN_PASSWORD_LENGTH} символов`
    );
    expect(screen.getByText(`Не менее ${MIN_PASSWORD_LENGTH} символов`)).toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');

    // Проверяем по признаку ошибки у поля, а не по тексту: «Повторите
    // пароль» — это ещё и подпись, она на экране в любом случае.
    expect(screen.getByLabelText('Имя пользователя')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Повторите пароль')).not.toHaveAttribute('aria-invalid');
  });

  it('переходит по Enter и не встречает ошибками следующий шаг', async () => {
    renderAuth({ page: 'register' });

    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    // Enter в единственном поле шага — то же, что нажать «Продолжить».
    await userEvent.type(screen.getByLabelText('Имя'), 'Максим{Enter}');

    expect(await screen.findByLabelText('Имя пользователя')).toBeInTheDocument();
    // Человек только пришёл на шаг — претензий к пустым полям быть не может.
    expect(screen.queryByText('Не менее 3 символов')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).not.toHaveAttribute('aria-invalid');
  });

  it('забывает прошлые претензии при возврате на шаг', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    // Попытались отправить пустую форму — ошибки заслуженные.
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(await screen.findByText('Не менее 3 символов')).toBeInTheDocument();

    // Ушли назад и вернулись: поля те же, но претензии к пустым полям
    // повторяться не должны — попытки уйти с этого шага ещё не было.
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));

    expect(screen.queryByText('Не менее 3 символов')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Повторите пароль')).not.toHaveAttribute('aria-invalid');
  });

  it('отправляет фамилию и язык', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(api('/auth/register'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ token: 'token-1', user: { id: 'user-1' } });
      })
    );

    renderAuth({ page: 'register' });

    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    await userEvent.type(screen.getByLabelText('Имя'), 'Максим');
    await userEvent.type(screen.getByLabelText('Фамилия'), 'Донской');
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));

    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await screen.findByText('Список чатов');
    expect(body.lastName).toBe('Донской');
    // Язык — тот, на котором человек сейчас видит мастер.
    expect(body.language).toBe('ru');
  });

  it('фамилию можно не заполнять', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(api('/auth/register'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ token: 'token-1', user: { id: 'user-1' } });
      })
    );

    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await screen.findByText('Список чатов');
    expect(body.lastName).toBe('');
  });

  it('проверяет имя пользователя по формату', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'мак сим');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Только латинские буквы, цифры и _')).toBeInTheDocument();
  });

  it('не даёт зарегистрироваться с разными паролями', async () => {
    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol654321!');
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
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Это имя пользователя занято')).toBeInTheDocument();
    // И человек остался на шаге, где это поле есть.
    expect(screen.getByLabelText('Имя пользователя')).toHaveValue('maximdon');
  });

  it('отказ сервера по паролю показывает у поля пароля', async () => {
    // Наши правила повторяют серверную политику, но могут отстать: её
    // меняют на сервере, а клиент узнаёт об этом позже. Тогда причина
    // должна встать у поля, а не улететь общим тостом.
    server.use(
      http.post(api('/auth/register'), () =>
        HttpResponse.json(
          { code: 'weak_password', error: 'password does not meet security requirements' },
          { status: 400 }
        )
      )
    );

    renderAuth({ page: 'register' });

    await goToCredentials();
    await userEvent.type(screen.getByLabelText('Имя пользователя'), 'maximdon');
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Пароль не отвечает требованиям')).toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
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
    await userEvent.type(screen.getByLabelText('Пароль'), 'Parol123456!');
    await userEvent.type(screen.getByLabelText('Повторите пароль'), 'Parol123456!');
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await screen.findByText('Список чатов');
    expect(body.firstName).toBe('Максим');
    expect(body.username).toBe('maximdon');
  });
});
