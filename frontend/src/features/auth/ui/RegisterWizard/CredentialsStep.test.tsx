import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useForm } from 'react-hook-form';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { CredentialsStep } from './CredentialsStep';
import type { TRegisterForm } from '../../model/registerSchema';

function CredentialsStepWrapper({
  initialValues = { username: '', password: '', passwordRepeat: '' },
  errorOf = () => undefined,
}: {
  initialValues?: Partial<TRegisterForm>;
  errorOf?: (field: keyof TRegisterForm) => string | undefined;
}) {
  const { register, watch } = useForm<TRegisterForm>({
    defaultValues: {
      firstName: '',
      lastName: '',
      username: initialValues.username ?? '',
      password: initialValues.password ?? '',
      passwordRepeat: initialValues.passwordRepeat ?? '',
    },
  });

  return (
    <CredentialsStep
      errorOf={errorOf}
      password={watch('password')}
      register={register}
      username={watch('username')}
    />
  );
}

function renderCredentialsStep(
  initialValues?: Partial<TRegisterForm>,
  errorOf?: (field: keyof TRegisterForm) => string | undefined
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <CredentialsStepWrapper errorOf={errorOf} initialValues={initialValues} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('CredentialsStep: проверка доступности имени пользователя', () => {
  it('показывает подсказку о доступности имени, если сервер ответил available: true', async () => {
    server.use(
      http.get(api('/users/check-username'), () => HttpResponse.json({ available: true }))
    );

    renderCredentialsStep({ username: 'alexandra' });

    expect(await screen.findByText('Имя пользователя свободно')).toBeInTheDocument();
  });

  it('показывает ошибку о занятости имени, если сервер ответил available: false', async () => {
    server.use(
      http.get(api('/users/check-username'), () => HttpResponse.json({ available: false }))
    );

    renderCredentialsStep({ username: 'existing_user' });

    expect(await screen.findByText('Это имя пользователя занято')).toBeInTheDocument();
  });

  it('не ломает интерфейс и не показывает ошибку при ответе 401', async () => {
    server.use(
      http.get(api('/users/check-username'), () =>
        HttpResponse.json({ code: 'missing_token' }, { status: 401 })
      )
    );

    renderCredentialsStep({ username: 'newuser' });

    // Ждём завершения запроса: текст ошибки или успеха не должен появиться
    expect(screen.queryByText('Это имя пользователя занято')).not.toBeInTheDocument();
    expect(screen.queryByText('Имя пользователя свободно')).not.toBeInTheDocument();
  });

  it('отдаёт приоритет ошибке формы схемы над проверкой сервера', async () => {
    server.use(
      http.get(api('/users/check-username'), () => HttpResponse.json({ available: true }))
    );

    renderCredentialsStep(
      { username: 'al' },
      (field) => (field === 'username' ? 'Не менее 3 символов' : undefined)
    );

    expect(screen.getByText('Не менее 3 символов')).toBeInTheDocument();
    expect(screen.queryByText('Имя пользователя свободно')).not.toBeInTheDocument();
  });
});
