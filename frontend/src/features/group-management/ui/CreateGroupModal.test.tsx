import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { useProfileStore } from '@/entities/user';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { testI18n } from '@/test/harness/i18n';
import { makeUser } from '@/test/fixtures';
import { ToastStack } from '@/shared/ui';
import { CreateGroupModal } from './CreateGroupModal';

/**
 * Уменьшение картинки идёт через canvas, которого в jsdom нет. Оно вынесено
 * отдельным модулем и здесь подменяется: аватарка проверяется вживую.
 */
vi.mock('@/shared/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib')>();
  return {
    ...actual,
    downscaleImage: async () => 'data:image/jpeg;base64,УМЕНЬШЕННАЯ',
  };
});

const ME = makeUser({ id: 'user-1', firstName: 'Я' });

interface ICreateBody {
  title: string;
  description: string;
  members: string[];
  avatarUrl?: string;
}

function renderModal(onClose = () => {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  useProfileStore.setState({ user: ME, isAuth: true });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter>
          {/* Уведомления живут в корневом макете: без него отказ сервера
              некому показать. */}
          <ToastStack />
          <CreateGroupModal onClose={onClose} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

function withChats() {
  server.use(
    http.get(api('/chats'), () =>
      HttpResponse.json({
        chats: [
          { id: 'c1', type: 'private', peerId: 'boris', title: 'Борис' },
          { id: 'c2', type: 'group', title: 'Рабочий чат' },
        ],
      })
    )
  );
}

function watchCreate(response: () => Response) {
  const bodies: ICreateBody[] = [];

  server.use(
    http.post(api('/chats/groups'), async ({ request }) => {
      bodies.push((await request.json()) as ICreateBody);
      return response();
    })
  );

  return bodies;
}

beforeEach(() => {
  withChats();
});

describe('создание группы', () => {
  it('should offer people you already talk to', async () => {
    // Пока поиск пуст, список берётся из уже загруженных чатов — без
    // единого запроса к поиску.
    let searchRequests = 0;
    server.use(
      http.get(api('/users/search'), () => {
        searchRequests += 1;
        return HttpResponse.json({ users: [] });
      })
    );

    renderModal();

    expect(await screen.findByText('Борис')).toBeInTheDocument();
    // Группа в подсказках не участвует: её состав из списка чатов не виден.
    expect(screen.queryByText('Рабочий чат')).not.toBeInTheDocument();
    expect(searchRequests).toBe(0);
  });

  it('should send what was filled in', async () => {
    const bodies = watchCreate(() => HttpResponse.json({ chatId: 'new-chat' }));
    const user = userEvent.setup();

    renderModal();

    await user.type(screen.getByPlaceholderText('Название группы'), 'Поход');
    await user.type(
      screen.getByPlaceholderText('Описание (необязательно)'),
      'Собираемся в субботу'
    );
    await user.click(await screen.findByText('Борис'));
    await user.click(screen.getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      title: 'Поход',
      description: 'Собираемся в субботу',
      members: ['boris'],
    });
  });

  it('should not send a group without a name', async () => {
    // Без названия группа была бы безымянной строкой в списке чатов.
    const bodies = watchCreate(() => HttpResponse.json({ chatId: 'new-chat' }));
    const user = userEvent.setup();

    renderModal();

    await user.click(await screen.findByText('Борис'));
    await user.click(screen.getByRole('button', { name: 'Создать группу' }));

    expect(bodies).toHaveLength(0);
  });

  it('создаёт группу и без участников — группа из одного владельца', async () => {
    const bodies = watchCreate(() => HttpResponse.json({ chatId: 'new-chat' }));
    const user = userEvent.setup();

    renderModal();

    await user.type(screen.getByPlaceholderText('Название группы'), 'Поход');
    await user.click(screen.getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ title: 'Поход', members: [] });
  });

  it('should close itself once the group is created', async () => {
    watchCreate(() => HttpResponse.json({ chatId: 'new-chat' }));
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderModal(onClose);

    await user.type(screen.getByPlaceholderText('Название группы'), 'Поход');
    await user.click(await screen.findByText('Борис'));
    await user.click(screen.getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('should keep what was filled in when the server refuses', async () => {
    // Отказ сервера не должен стоить человеку заново набранного названия и
    // заново отмеченных участников.
    watchCreate(() => HttpResponse.json({ error: 'нет' }, { status: 500 }));
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderModal(onClose);

    await user.type(screen.getByPlaceholderText('Название группы'), 'Поход');
    await user.click(await screen.findByText('Борис'));
    await user.click(screen.getByRole('button', { name: 'Создать группу' }));

    expect(
      await screen.findByText('Не удалось создать групповой чат, что-то пошло не так')
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Название группы')).toHaveValue('Поход');
  });

  it('should replace the suggestions with search results', async () => {
    // Как только человек ищет, подсказки уступают место найденным: иначе
    // непонятно, что из списка — результат поиска.
    server.use(
      http.get(api('/users/search'), () =>
        HttpResponse.json({ users: [{ id: 'carol', username: 'carol', firstName: 'Кэрол' }] })
      )
    );
    const user = userEvent.setup();

    renderModal();
    expect(await screen.findByText('Борис')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Поиск по юзернейму...'), 'car');

    expect(await screen.findByText('Кэрол')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Борис')).not.toBeInTheDocument());
  });
});
