import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { testI18n } from '@/test/harness/i18n';
import { CloudPasswordForm } from './CloudPasswordForm';

function renderForm(onSubmit = vi.fn(async () => {})) {
  render(
    <I18nextProvider i18n={testI18n}>
      <CloudPasswordForm onSubmit={onSubmit} submitLabel="Сохранить" />
    </I18nextProvider>
  );
  return onSubmit;
}

async function fill(password: string, confirmation = password) {
  await userEvent.type(screen.getByLabelText('Облачный пароль'), password);
  await userEvent.type(screen.getByLabelText('Повторите облачный пароль'), confirmation);
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
}

describe('облачный пароль: форма (#744)', () => {
  /* Подменяется метод сервиса, а не модуль: тесты идут без изоляции
     (isolate: false), и vi.mock модуля, который уже загрузил соседний
     файл, в CI не срабатывает. */
  let isLoginPassword: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    isLoginPassword = vi.spyOn(services.cryptoService, 'isLoginPassword').mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('требует не меньше 12 символов', async () => {
    const onSubmit = renderForm();

    await fill('короткий');

    expect(await screen.findByText('Не менее 12 символов')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('требует повторить пароль без расхождений', async () => {
    const onSubmit = renderForm();

    await fill('длинная фраза из слов', 'длинная фраза из слоf');

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('не принимает пароль входа: его знает сервер', async () => {
    isLoginPassword.mockResolvedValue(true);
    const onSubmit = renderForm();

    await fill('Пароль-входа-12345');

    expect(await screen.findByText(/Не используйте пароль входа/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('отдаёт подходящий пароль дальше', async () => {
    const onSubmit = renderForm();

    await fill('длинная фраза из слов');

    expect(onSubmit).toHaveBeenCalledWith('длинная фраза из слов');
  });

  it('показывает ошибку сохранения у поля', async () => {
    renderForm(vi.fn(async () => Promise.reject(new Error('Сервер недоступен'))));

    await fill('длинная фраза из слов');

    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument();
  });
});
