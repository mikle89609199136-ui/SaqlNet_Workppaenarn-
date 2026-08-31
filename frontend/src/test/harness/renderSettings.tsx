import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ToastStack } from '@/components/ui';
import { DEFAULT_SETTINGS_SECTION, ROUTES, type TSettingsSection } from '@/consts/routes';
import { SettingsDetailPage } from '@/pages/SettingsPage/SettingsDetailPage';
import { userKeys } from '@/queries/keys';
import { useProfileStore } from '@/store/profile';
import type { ISettingsDto, IUserDto } from '@/types';
import { makeUser } from '@/test/fixtures';
import { testI18n } from './i18n';

interface IRenderSettingsOptions {
  /** Раздел, с которого открывается страница. */
  section?: TSettingsSection;
  /** Подстраница раздела «Аккаунт»: profile, email, password и прочие. */
  subsection?: string;
  /**
   * Настройки, положенные в кеш до отрисовки. Если не передать, страница
   * запросит их сама — так проверяются состояние загрузки и ответ сервера.
   */
  settings?: Partial<ISettingsDto>;
  /** Параметры приватности из того же ответа сервера. */
  privacy?: Record<string, unknown>;
  currentUser?: IUserDto;
  /** Запрос в строке поиска над меню. */
  searchQuery?: string;
  queryClient?: QueryClient;
}

export { createTestQueryClient };

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Повторы и фоновые обновления в тесте только маскируют ошибки:
        // упавший запрос должен падать сразу и видимо.
        retry: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      // Повтор мутации скрыл бы главное, что здесь проверяется: что
      // неудачное сохранение возвращает прежнее значение.
      mutations: { retry: false },
    },
  });
}

/**
 * Рендер настроек на выбранном разделе.
 *
 * Раздел выбирается адресом, а не пропсом, поэтому оснастка поднимает
 * настоящий маршрутизатор с той же вложенностью, что и приложение:
 * иначе тест проверял бы устройство, которого в работе нет.
 *
 * Данные кладутся в кеш до отрисовки — по образцу `renderChatThread`.
 * Тест, которому важен именно поход к серверу, настройки не передаёт и
 * описывает ответ обработчиком msw.
 */
export function renderSettings({
  section = DEFAULT_SETTINGS_SECTION,
  subsection,
  settings,
  privacy,
  currentUser = makeUser({ id: 'user-1' }),
  searchQuery = '',
  queryClient = createTestQueryClient(),
}: IRenderSettingsOptions = {}): RenderResult {
  useProfileStore.setState({ user: currentUser, isAuth: true, token: 'test-token' });

  queryClient.setQueryData(userKeys.me(), currentUser);

  // Настройки и приватность сервер отдаёт одним ответом, поэтому и в кеше
  // они лежат вместе: положить только половину — значит проверять форму
  // данных, которой не бывает.
  if (settings || privacy) {
    queryClient.setQueryData(userKeys.settings(), {
      settings: settings ?? {},
      privacy: privacy ?? {},
    });
  }

  const path = subsection
    ? ROUTES.SETTINGS_SUBSECTION(section, subsection)
    : ROUTES.SETTINGS_SECTION(section);

  const router = createMemoryRouter(
    [
      {
        path: '/settings',
        // Data-router требует состояние загрузки для первой отрисовки.
        HydrateFallback: () => <div>Загрузка…</div>,
        element: <Outlet context={{ searchQuery }} />,
        children: [
          { path: ':section', element: <SettingsDetailPage /> },
          { path: ':section/:subsection', element: <SettingsDetailPage /> },
        ],
      },
    ],
    { initialEntries: [path] }
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        {/* В приложении стек тостов стоит в корневом макете. Без него
            сообщение об ошибке сохранения некому показать, и тест не смог бы
            проверить то, что видит человек. */}
        <ToastStack />
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}
