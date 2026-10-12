import i18n from 'i18next';
import { chatQuery } from '@/entities/chat';
import { messagesQuery } from '@/entities/message';
import { queryClient } from '@/shared/api';
import { meQuery, settingsQuery, useProfileStore } from '@/entities/user';
import { createBrowserRouter, redirect, type Params } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';
import { AppLayout, RootLayout } from '@/app/layouts';
import { RouteLoadingFallback } from '@/shared/ui';
import { DEFAULT_SETTINGS_SECTION, REACT_ROUTES, ROUTES } from '@/shared/config/routes';
import { clearAuthSession } from '@/features/auth';
import { settingsSectionRoutes } from '@/pages/settings/settingsSectionRoutes';

async function requireSession({ request }: { request: Request }) {
  const signedIn = useProfileStore.getState().isAuth;
  const from = new URL(request.url).pathname;
  if (!signedIn) {
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

    // Тема и язык применяются ко всему приложению, поэтому настройки нужны
    // не только на своей странице. Неудача здесь сессию не рушит: без них
    // интерфейс работает на том, что записано в проекции.
    void queryClient.fetchQuery(settingsQuery()).catch(() => {});
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;

    if (error?.status === 401) {
      clearAuthSession();
      throw redirect(`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(from)}`);
    }

    // сеть / 500 / таймаут — токен тут ни при чём, сессию не трогаем
    throw new Response(
      error?.message || i18n.t('errors.profileLoad', 'Не удалось загрузить профиль'),
      {
        status: error?.status ?? 500,
      }
    );
  }

  return null;
}

function redirectIfAuthed() {
  if (useProfileStore.getState().isAuth) throw redirect(REACT_ROUTES.CHATS);
  return null;
}

function redirectHome() {
  return redirect(useProfileStore.getState().isAuth ? REACT_ROUTES.CHATS : REACT_ROUTES.LOGIN);
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
    throw new Response(error.message || i18n.t('errors.chatLoad', 'Не удалось загрузить чат'), {
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
          import('@/pages/login').then((m) => ({
            Component: m.LoginPage,
          })),
      },
      {
        path: REACT_ROUTES.REGISTER,
        loader: redirectIfAuthed,
        lazy: () =>
          import('@/pages/register').then((m) => ({
            Component: m.RegisterPage,
          })),
      },
      /* Вне AuthGuard: страница сама отправит на вход, сохранив ссылку из
         кода, — через загрузчик сессии фрагмент адреса бы потерялся. */
      {
        path: REACT_ROUTES.LINK,
        lazy: () =>
          import('@/pages/link').then((m) => ({
            Component: m.LinkPage,
          })),
      },
      /* Тоже вне AuthGuard: сюда приходит устройство без сессии. */
      {
        path: REACT_ROUTES.QR_LOGIN,
        lazy: () =>
          import('@/pages/qr-login').then((m) => ({
            Component: m.QrClaimPage,
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
                  import('@/pages/chats').then((m) => ({
                    Component: m.ChatsPage,
                  })),
                children: [
                  {
                    index: true,
                    lazy: () =>
                      import('@/widgets/chat-messages').then((m) => ({
                        Component: m.EmptyChatPlaceholder,
                      })),
                  },
                  {
                    path: REACT_ROUTES.CHAT_BY_ID,
                    loader: chatLoader,
                    shouldRevalidate: ({ currentParams, nextParams }) =>
                      currentParams.chatId !== nextParams.chatId,
                    lazy: () =>
                      import('@/pages/chat-thread').then((m) => ({
                        Component: m.ChatThreadPage,
                      })),
                  },
                ],
              },
              /* Страниц-заглушек каналов, сообществ и встреч больше нет
                 (#818): разделы стали вкладками списка чатов. Старые
                 адреса ловит общий перехват ниже и ведёт в чаты. */
              {
                path: REACT_ROUTES.SETTINGS,
                lazy: () =>
                  import('@/pages/settings').then((m) => ({
                    Component: m.SettingsPage,
                  })),
                children: [
                  /* Без раздела в адресе: на ПК — первый раздел, чтобы у
                     открытого экрана был свой адрес; на телефоне — меню
                     настроек, это отдельный экран (#828). */
                  {
                    index: true,
                    lazy: () =>
                      import('@/pages/settings').then((m) => ({ Component: m.SettingsIndex })),
                  },
                  ...settingsSectionRoutes,
                  /* Раздел, которого нет в списке, — не ошибка и не пустой
                     экран: показываем первый, как и при заходе без раздела.

                     Пустой Component обязателен, хотя маршрут ничего не
                     рисует: без него роутер предупреждает о совпавшем
                     маршруте без элемента — до редиректа он этого ещё не
                     знает. */
                  {
                    path: '*',
                    loader: () => redirect(ROUTES.SETTINGS_SECTION(DEFAULT_SETTINGS_SECTION)),
                    Component: () => null,
                  },
                ],
              },
            ],
          },
          {
            path: '*',
            loader: () => redirect(REACT_ROUTES.HOME),
            Component: () => null,
          },
        ],
      },
    ],
  },
]);
