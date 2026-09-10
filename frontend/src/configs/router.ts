import { chatQuery, messagesQuery } from '@/queries/chat/threadQueries';
import { queryClient } from '@/queries/queryClient';
import { meQuery } from '@/queries/users/meQuery';
import { settingsQuery } from '@/queries/users/settingsQuery';
import { useProfileStore } from '@/store';
import type { ComponentType } from 'react';
import { createBrowserRouter, redirect, type Params } from 'react-router-dom';
import { AuthGuard } from '../components/guards/AuthGuard';
import { AppLayout, RootLayout } from '@/layouts';
import { RouteLoadingFallback } from '@/shared/ui';
import {
  DEFAULT_SETTINGS_SECTION,
  REACT_ROUTES,
  ROUTES,
  SETTINGS_SECTIONS,
  type TSettingsSection,
} from '@/shared/config/routes';
import { clearAuthSession } from '@/utils/clearAuthSession';

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
/**
 * Разделы настроек — по маршруту на каждый.
 *
 * Список один и тот же и для меню, и для маршрутов: раздела, которого нет
 * в `SETTINGS_SECTIONS`, не существует и для адреса. Тип `Record` не даст
 * добавить раздел в список и забыть про его экран.
 *
 * Импорты записаны по одному, а не собраны выражением: сборщику нужно
 * видеть каждый путь, иначе разделы не разъедутся по отдельным частям.
 */
const SECTION_COMPONENTS: Record<TSettingsSection, () => Promise<{ Component: ComponentType }>> = {
  account: () =>
    import('../pages/SettingsPage/sections/AccountSection.js').then((m) => ({
      Component: m.AccountSection,
    })),
  notifications: () =>
    import('../pages/SettingsPage/sections/NotificationsSection.js').then((m) => ({
      Component: m.NotificationsSection,
    })),
  appearance: () =>
    import('../pages/SettingsPage/sections/AppearanceSection.js').then((m) => ({
      Component: m.AppearanceSection,
    })),
  privacy: () =>
    import('../pages/SettingsPage/sections/PrivacySection.js').then((m) => ({
      Component: m.PrivacySection,
    })),
  language: () =>
    import('../pages/SettingsPage/sections/LanguageSection.js').then((m) => ({
      Component: m.LanguageSection,
    })),
  about: () =>
    import('../pages/SettingsPage/sections/AboutSection.js').then((m) => ({
      Component: m.AboutSection,
    })),
};

/* Подстраницы есть пока только у аккаунта, и разбирает их он сам. */
const settingsSectionRoutes = SETTINGS_SECTIONS.flatMap((section) => {
  const lazy = SECTION_COMPONENTS[section];
  const route = { path: section, lazy };

  return section === 'account' ? [route, { path: `${section}/:subsection`, lazy }] : [route];
});

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
                      import('../components/features/ChatThread/EmptyChatPlaceholder').then(
                        (m) => ({
                          Component: m.EmptyChatPlaceholder,
                        })
                      ),
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
              /* Разделы, которых ещё нет. Без своих маршрутов их ловил общий
                 перехват и возвращал в чаты: адрес менялся, экран оставался
                 прежним, и выходило, будто кнопка сломана. */
              {
                path: REACT_ROUTES.CHANNELS,
                lazy: () =>
                  import('../pages/SectionStubPage/SectionStubPage.js').then((m) => ({
                    Component: m.ChannelsPage,
                  })),
              },
              {
                path: REACT_ROUTES.COMMUNITIES,
                lazy: () =>
                  import('../pages/SectionStubPage/SectionStubPage.js').then((m) => ({
                    Component: m.CommunitiesPage,
                  })),
              },
              {
                path: REACT_ROUTES.MEETINGS,
                lazy: () =>
                  import('../pages/SectionStubPage/SectionStubPage.js').then((m) => ({
                    Component: m.MeetingsPage,
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
