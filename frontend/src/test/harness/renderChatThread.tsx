import { render, type RenderResult } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ChatThreadPage } from '@/pages/ChatThreadPage/ChatThreadPage';
import { useProfileStore } from '@/store/profile';
import type { IChatDto, IMessageDto, IPinnedDto, IUserDto } from '@/types';
import { makeUser } from '@/test/fixtures';
import { testI18n } from './i18n';

interface IRenderChatThreadOptions {
  chat: IChatDto;
  messages?: IMessageDto[];
  pins?: IPinnedDto[];
  /** Кто открыл чат. Без пользователя в сторе лента сообщений не рисуется. */
  currentUser?: IUserDto;
}

/**
 * Рендер страницы чата с готовыми данными.
 *
 * Тесты не знают, откуда данные приходят: сегодня их приносит загрузчик
 * маршрута, после перехода на кеш запросов — сам компонент. Это единственное
 * место, которое придётся изменить при миграции; сами тесты останутся как есть.
 *
 * Сетевые ответы задаются обработчиками MSW — страница делает и собственные
 * запросы помимо загрузчика.
 */
export function renderChatThread({
  chat,
  messages = [],
  pins = [],
  currentUser = makeUser({ id: 'user-1' }),
}: IRenderChatThreadOptions): RenderResult {
  useProfileStore.setState({ user: currentUser, isAuth: true, token: 'test-token' });

  const router = createMemoryRouter(
    [
      {
        path: '/chats',
        // Data-router требует состояние загрузки для первой отрисовки.
        // В приложении его до сих пор нет — react-router предупреждает об
        // этом в консоли, и вместо разметки чата виден статичный «Загрузка…».
        HydrateFallback: () => <div>Загрузка…</div>,
        // Страница ждёт контекст от родительского маршрута: через него она
        // сообщает наверх, какой профиль показывать в боковой панели.
        element: (
          <Outlet
            context={{
              onProfileStateChange: () => {},
              profileCloseToken: 0,
              profileMode: 'panel' as const,
            }}
          />
        ),
        children: [
          {
            path: ':chatId',
            loader: () => ({
              loadedChat: chat,
              loadedMessages: messages,
              loadedPinnedMessages: pins,
            }),
            element: <ChatThreadPage />,
          },
        ],
      },
    ],
    { initialEntries: [`/chats/${chat.id}`] }
  );

  return render(
    <I18nextProvider i18n={testI18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  );
}
