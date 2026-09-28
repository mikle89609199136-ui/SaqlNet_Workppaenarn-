import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ToastStack } from '@/shared/ui';
import { ROUTES } from '@/shared/config/routes';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { useProfileStore } from '@/entities/user';
import { testI18n } from './i18n';

interface IRenderAuthOptions {
  /* Какую страницу входной группы поднимать. */
  page?: 'login' | 'register';
  /* Адрес целиком — когда важна строка запроса, например `?from=`. */
  path?: string;
}

/**
 * Рендер входа или регистрации.
 *
 * Маршрутизатор настоящий, потому что обе страницы им пользуются: вход
 * читает `?from=` и уводит на чаты, регистрация — на чаты после успеха.
 * Страницы-заглушки для `/chats` достаточно, чтобы проверить сам переход.
 *
 * Хранилище профиля чистится перед каждым рендером: вошедшего страница
 * входа сразу перенаправляет, и остаток от прошлого теста ломал бы всё
 * последующее.
 */
export function renderAuth({ page = 'login', path }: IRenderAuthOptions = {}): RenderResult {
  useProfileStore.setState({ user: null, isAuth: false, token: null });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const router = createMemoryRouter(
    [
      { path: ROUTES.LOGIN, element: <LoginPage /> },
      { path: ROUTES.REGISTER, element: <RegisterPage /> },
      { path: ROUTES.CHATS, element: <div>Список чатов</div> },
      /* Куда возвращает `?from=`: собственная страница, чтобы отличать
         её от чатов. */
      { path: '/chats/:chatId', element: <div>Переписка</div> },
    ],
    { initialEntries: [path ?? (page === 'login' ? ROUTES.LOGIN : ROUTES.REGISTER)] }
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastStack />
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}
