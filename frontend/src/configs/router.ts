import { chatQuery, messagesQuery } from '@/queries/chat/threadQueries';
import { queryClient } from '@/queries/queryClient';
import { meQuery } from '@/queries/users/meQuery';
import { useProfileStore } from '@/store';
import { createBrowserRouter, redirect, type Params } from 'react-router-dom';
import { AuthGuard } from '../components/guards/AuthGuard.js';
import { AppLayout } from '../components/layouts/AppLayout.js';
import { RootLayout } from '../components/layouts/RootLayout.js';
import { RouteLoadingFallback } from '../components/ui/RouteLoadingFallback.js';
import {
  DEFAULT_SETTINGS_SECTION,
  REACT_ROUTES,
  ROUTES,
  isSettingsSection,
} from '../consts/routes';
import { clearAuthSession } from '../utils/clearAuthSession.js';

async function requireSession({ request }: { request: Request }) {
  const token = useProfileStore.getState().token;
  const from = new URL(request.url).pathname;
  if (!token) {
    throw redirect(`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(from)}`);
  }

  try {
    // Профиль читается из кеша запросов: загрузчик срабатывает на каждой
    // навигации, а данные, которые меняются раз в сессию, незачем
    // перезапрашивать при каждом переходе.
    //
    // Именно fetchQuery, а не ensureQueryData: второй отдаёт что угодно,
    // лишь бы оно было в кеше, и после инвалидации профиля навигация
    // вернула бы прежние имя и аватар.
    const user = await queryClient.fetchQuery(meQuery());
    useProfileStore.getState().setUser(user);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;

    if (error?.status === 401) {
      clearAuthSession();
      throw redirect(`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(from)}`);
    }

    // сеть / 500 / таймаут — токен тут ни при чём, сессию не трогаем
    throw new Response(error?.message || 'Не удалось загрузить профиль', {
      status: error?.status ?? 500,
    });
  }

  return null;
}

function redirectIfAuthed() {
  const token = useProfileStore.getState().token;
  if (token) throw redirect(REACT_ROUTES.CHATS);
  return null;
}

function redirectHome() {
  const token = useProfileStore.getState().token;
  return redirect(token ? REACT_ROUTES.CHATS : REACT_ROUTES.LOGIN);
}

/**
 * Предзагрузка чата.
 *
 * Загрузчик больше не источник данных: он лишь наполняет кеш до первой
 * отрисовки, а страница читает через запросы. Так тред остаётся живым —
 * события и мутации обновляют ровно то, что нарисовано, тогда как прежний
 * useLoaderData отдавал снимок, замороженный до следующей навигации.
 *
 * Закреплённые сюда не входят: панель закреплённых не нужна, чтобы показать
 * чат, а ожидание её ответа задерживало весь экран (#225).
 */
const chatLoader = async ({ params }: { params: Params }) => {
  const { chatId = '' } = params;
  try {
    // Историю запрашиваем сразу, но не ждём: пока она идёт, на её месте
    // рисуется скелет, а шапка и поле ввода уже на экране. Ожидание обоих
    // ответов означало белый экран на всё время самого медленного.
    void queryClient.prefetchInfiniteQuery(messagesQuery(chatId));

    await queryClient.ensureQueryData(chatQuery(chatId));
    return null;
  } catch (error: any) {
    throw new Response(error.message || 'Не удалось загрузить чат', {
      status: 500,
    });
  }
};

/**
 * Раздел настроек из адреса.
 *
 * Незнакомое имя раздела уводит на первый, а не показывает его содержимое
 * под чужим адресом: расхождение между строкой адреса и тем, что на экране,
 * хуже тихого перенаправления. Настройки открывают из меню, а не по внешним
 * ссылкам, поэтому терять тут нечего.
 */
const settingsSectionLoader = ({ params }: { params: Params }) => {
  if (!isSettingsSection(params.section)) {
    return redirect(ROUTES.SETTINGS_SECTION(DEFAULT_SETTINGS_SECTION));
  }
  return null;
};

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    children: [
      {
        index: true,
        loader: redirectHome,
      },
      {
        path: REACT_ROUTES.LOGIN,
        loader: redirectIfAuthed,
        lazy: () =>
          import('../pages/LoginPage/LoginPage.js').then((m) => ({
            Component: m.LoginPage,
          })),
      },
      {
        path: REACT_ROUTES.REGISTER,
        loader: redirectIfAuthed,
        lazy: () =>
          import('../pages/RegisterPage/RegisterPage.js').then((m) => ({
            Component: m.RegisterPage,
          })),
      },
      {
        Component: AuthGuard,
        loader: requireSession,
        HydrateFallback: RouteLoadingFallback,
        shouldRevalidate: () => false,
        children: [
          {
            Component: AppLayout,
            HydrateFallback: RouteLoadingFallback,
            children: [
              {
                path: REACT_ROUTES.CHATS,
                lazy: () =>
                  import('../pages/ChatsPage/ChatsPage.js').then((m) => ({
                    Component: m.ChatsPage,
                  })),
                children: [
                  {
                    index: true,
                    lazy: () =>
                      import('../components/features/EmptyChatPlaceholder.js').then((m) => ({
                        Component: m.EmptyChatPlaceholder,
                      })),
                  },
                  {
                    path: REACT_ROUTES.CHAT_BY_ID,
                    loader: chatLoader,
                    shouldRevalidate: ({ currentParams, nextParams }) =>
                      currentParams.chatId !== nextParams.chatId,
                    lazy: () =>
                      import('../pages/ChatThreadPage/ChatThreadPage.js').then((m) => ({
                        Component: m.ChatThreadPage,
                      })),
                  },
                ],
              },
              {
                path: REACT_ROUTES.CONTACTS,
                lazy: () =>
                  import('../pages/ContactsPage/ContactsPage.js').then((m) => ({
                    Component: m.ContactsPage,
                  })),
              },
              {
                path: REACT_ROUTES.SETTINGS,
                lazy: () =>
                  import('../pages/SettingsPage/SettingsPage.js').then((m) => ({
                    Component: m.SettingsPage,
                  })),
                children: [
                  /* Без раздела в адресе показывать нечего: отправляем на
                     первый, чтобы у открытого экрана всегда был свой адрес. */
                  {
                    index: true,
                    loader: () => redirect(ROUTES.SETTINGS_SECTION(DEFAULT_SETTINGS_SECTION)),
                  },
                  {
                    path: REACT_ROUTES.SETTINGS_SECTION,
                    loader: settingsSectionLoader,
                    lazy: () =>
                      import('../pages/SettingsPage/SettingsDetailPage.js').then((m) => ({
                        Component: m.SettingsDetailPage,
                      })),
                  },
                  {
                    path: REACT_ROUTES.SETTINGS_SUBSECTION,
                    loader: settingsSectionLoader,
                    lazy: () =>
                      import('../pages/SettingsPage/SettingsDetailPage.js').then((m) => ({
                        Component: m.SettingsDetailPage,
                      })),
                  },
                ],
              },
            ],
          },
          {
            path: '*',
            loader: () => redirect(REACT_ROUTES.HOME),
          },
        ],
      },
    ],
  },
]);
