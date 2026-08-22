import { useProfileStore } from '@/store';
import { createBrowserRouter, redirect, type Params } from 'react-router-dom';
import { AuthGuard } from '../components/guards/AuthGuard.js';
import { AppLayout } from '../components/layouts/AppLayout.js';
import { RootLayout } from '../components/layouts/RootLayout.js';
import { RouteLoadingFallback } from '../components/ui/RouteLoadingFallback.js';
import { REACT_ROUTES } from '../consts/routes';
import { services } from '../services/serviceContainer.js';
import { clearAuthSession } from '../utils/clearAuthSession.js';

async function requireSession({ request }: { request: Request }) {
  const token = useProfileStore.getState().token;
  const from = new URL(request.url).pathname;
  if (!token) {
    throw redirect(`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(from)}`);
  }

  try {
    const setUser = useProfileStore.getState().setUser;
    const user = await services.userService.getMe();
    setUser(user);
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

const chatLoader = async ({ params }: { params: Params }) => {
  const { chatId = '' } = params;
  try {
    const [chat, messages, pinnedMessages] = await Promise.all([
      services.chatService.getChat(chatId),
      services.messageService.getMessages(chatId),
      services.messageService.listPins(chatId),
    ]);
    return {
      loadedChat: chat,
      loadedMessages: messages,
      loadedPinnedMessages: pinnedMessages,
    };
  } catch (error: any) {
    throw new Response(error.message || 'Не удалось загрузить чат', {
      status: 500,
    });
  }
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
                      import('../components/components/EmptyChatPlaceholder.js').then((m) => ({
                        Component: m.EmptyChatPlaceholder,
                      })),
                  },
                  {
                    path: REACT_ROUTES.CHAT_BY_ID,
                    loader: chatLoader,
                    shouldRevalidate: ({ currentParams, nextParams }) =>
                      currentParams.chatId !== nextParams.chatId,
                    lazy: () =>
                      import('../pages/ChatPage/ChatThreadPage.js').then((m) => ({
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
              },
              {
                path: REACT_ROUTES.CREATE_GROUP,
                lazy: () =>
                  import('../pages/CreateGroupChatPage/CreateGroupPage.js').then((m) => ({
                    Component: m.CreateGroupPage,
                  })),
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
