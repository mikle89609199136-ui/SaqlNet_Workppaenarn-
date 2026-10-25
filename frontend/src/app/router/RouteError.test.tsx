import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, Link, Outlet, RouterProvider, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next, { type i18n as II18n } from 'i18next';
import enTranslations from '../../../public/locales/en/translation.json';
import { testI18n } from '@/test/harness/i18n';
import { REACT_ROUTES } from '@/shared/config/routes';
import { ChatRouteError, RootRouteError } from './RouteError';
import { routeErrorKind } from './routeErrorKind';

/**
 * Экраны ошибок маршрутов (#1071): вместо английского «Unexpected
 * Application Error!» без кнопок — экран на языке интерфейса, а ошибка
 * в чате не уносит список чатов.
 */

let reload: ReturnType<typeof vi.fn<() => void>>;
let online: boolean;
let chatLoad: (chatId: string) => Promise<null>;
let renderChat: (chatId: string) => React.ReactNode;

function ChatPage() {
  const { chatId = '' } = useParams();
  return <>{renderChat(chatId)}</>;
}

function renderTree(initialPath: string, rootLoader?: () => Promise<null>, i18n: II18n = testI18n) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        loader: rootLoader,
        HydrateFallback: () => null,
        ErrorBoundary: () => <RootRouteError isOnline={() => online} reload={reload} />,
        Component: () => (
          <div>
            <span>Список</span>
            <Link to="/chats/other">другой чат</Link>
            <Outlet />
          </div>
        ),
        children: [
          { path: 'chats', Component: () => <span>Выберите чат</span> },
          {
            path: 'chats/:chatId',
            loader: ({ params }) => chatLoad(params.chatId ?? ''),
            Component: ChatPage,
            ErrorBoundary: () => <ChatRouteError isOnline={() => online} reload={reload} />,
          },
        ],
      },
    ],
    { initialEntries: [initialPath] }
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  );
  return router;
}

beforeEach(() => {
  reload = vi.fn<() => void>();
  online = true;
  chatLoad = async () => null;
  renderChat = (chatId) => <span>чат {chatId}</span>;
  // Экран пишет ошибку в консоль, React — об исключении при отрисовке.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ошибка открытия чата', () => {
  it('404 — «Чат не найден», список на месте, «К списку чатов» ведёт к нему', async () => {
    chatLoad = async () => {
      throw { status: 404, code: 'chat_not_found', message: 'chat fetch failed' };
    };
    const router = renderTree('/chats/missing');

    expect(await screen.findByText('Чат не найден')).toBeInTheDocument();
    expect(screen.getByText('Список')).toBeInTheDocument();
    expect(screen.queryByText('chat fetch failed')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'К списку чатов' }));
    expect(router.state.location.pathname).toBe(REACT_ROUTES.CHATS);
  });

  it('400 на адрес не-UUID — тоже «Чат не найден», а не про заполненные поля', async () => {
    chatLoad = async () => {
      throw { status: 400, code: 'validation_failed' };
    };
    renderTree('/chats/abc');

    expect(await screen.findByText('Чат не найден')).toBeInTheDocument();
  });

  it('500 — «Не удалось загрузить чат» и «Перезагрузить»', async () => {
    chatLoad = async () => {
      throw { status: 500 };
    };
    renderTree('/chats/broken');

    expect(await screen.findByText('Не удалось загрузить чат')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Перезагрузить' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('исключение при отрисовке — экран только в панели чата, переход в другой чат работает', async () => {
    renderChat = (chatId) => {
      if (chatId === 'crash')
        throw new TypeError("Cannot read properties of undefined (reading 'x')");
      return <span>чат {chatId}</span>;
    };
    renderTree('/chats/crash');

    expect(await screen.findByText('Не удалось загрузить чат')).toBeInTheDocument();
    expect(screen.getByText('Список')).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();

    await userEvent.click(screen.getByRole('link', { name: 'другой чат' }));
    expect(await screen.findByText('чат other')).toBeInTheDocument();
  });

  it('без сети — «Нет подключения к интернету», с возвратом сети перезагрузка один раз', async () => {
    online = false;
    chatLoad = async () => {
      throw new TypeError('Failed to fetch');
    };
    renderTree('/chats/offline');

    expect(await screen.findByText('Нет подключения к интернету')).toBeInTheDocument();
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('ошибка на всё окно', () => {
  it('загрузчик корня упал — «Что-то пошло не так» и «Перезагрузить», на первой странице без «Назад»', async () => {
    renderTree('/chats', async () => {
      throw { status: 500 };
    });

    expect(await screen.findByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
  });

  it('по-английски', async () => {
    // Настоящий английский словарь: в тестовом — только ошибки API. Без
    // initReactI18next: он сделал бы экземпляр общим, и следующие файлы
    // тестов получили бы английские тексты.
    const en = i18next.createInstance();
    await en.init({
      lng: 'en',
      keySeparator: false,
      resources: { en: { translation: enTranslations } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    renderTree(
      '/chats',
      async () => {
        throw { status: 500 };
      },
      en
    );

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('вид ошибки', () => {
  it('без сети — офлайн, даже если сбой похож на что-то другое', () => {
    expect(routeErrorKind({ status: 500 }, false)).toBe('offline');
  });

  it('TypeError при сети — поломка, а не офлайн', () => {
    expect(routeErrorKind(new TypeError('x is undefined'), true)).toBe('failed');
  });

  it.each([400, 403, 404])('%s — не найдено', (status) => {
    expect(routeErrorKind({ status }, true)).toBe('notFound');
  });
});
