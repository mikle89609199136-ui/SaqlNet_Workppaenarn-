import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ChatThreadPage } from '@/pages/ChatThreadPage/ChatThreadPage';
import { chatKeys } from '@/queries/keys';
import { RealtimeEvents } from '@/realtime/RealtimeEvents';
import { useProfileStore } from '@/store/profile';
import type { IChatDto, IMessageDto, IPinnedDto, IUserDto } from '@/types';
import { makeUser } from '@/test/fixtures';
import { testI18n } from './i18n';

interface IRenderChatThreadOptions {
  chat: IChatDto;
  /**
   * История, положенная в кеш до отрисовки. Если не передать, страница
   * загрузит её сама — так проверяются сценарии с реальным запросом.
   */
  messages?: IMessageDto[];
  pins?: IPinnedDto[];
  /** Кто открыл чат. Без пользователя в сторе лента сообщений не рисуется. */
  currentUser?: IUserDto;
  /**
   * Общий клиент запросов. В приложении он один на всю вкладку, поэтому
   * сценарии с переходом между чатами обязаны использовать один и тот же —
   * иначе изоляцию обеспечит тест, а не проверяемый код.
   */
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
      mutations: { retry: false },
    },
  });
}

/**
 * Рендер страницы чата с готовыми данными.
 *
 * Тесты не знают, откуда данные приходят: раньше их приносил загрузчик
 * маршрута, теперь они кладутся в кеш запросов до первой отрисовки.
 * Это единственное место, которое изменилось при миграции — сами тесты
 * остались прежними.
 */
export function renderChatThread({
  chat,
  messages,
  pins = [],
  currentUser = makeUser({ id: 'user-1' }),
  queryClient = createTestQueryClient(),
}: IRenderChatThreadOptions): RenderResult {
  useProfileStore.setState({ user: currentUser, isAuth: true, token: 'test-token' });

  queryClient.setQueryData(chatKeys.detail(chat.id), chat);
  queryClient.setQueryData(chatKeys.pins(chat.id), pins);

  // История хранится страницами: первая — самые свежие сообщения.
  if (messages) {
    queryClient.setQueryData(chatKeys.messages(chat.id), {
      pages: [messages],
      pageParams: [0],
    });
  }

  const router = createMemoryRouter(
    [
      {
        path: '/chats',
        // Data-router требует состояние загрузки для первой отрисовки.
        HydrateFallback: () => <div>Загрузка…</div>,
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
            element: <ChatThreadPage />,
          },
        ],
      },
    ],
    { initialEntries: [`/chats/${chat.id}`] }
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        {/* События сервера обрабатываются на уровне приложения, а не страницы:
            без этого подписчика тред не узнает о входящих сообщениях. */}
        <RealtimeEvents />
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}
