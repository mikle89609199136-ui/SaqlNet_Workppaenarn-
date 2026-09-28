import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProfileStore } from '@/entities/user';
import { makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { GroupInfoModal } from './GroupInfoModal';

const ME = 'user-me';

const member = (id: string, username: string, role: string) => ({
  id,
  username,
  firstName: '',
  lastName: '',
  avatarUrl: '',
  role,
  permissions: {},
  joinedAt: '2026-09-01T00:00:00Z',
});

/** Группа, где я с заданной ролью, и Анна — рядовой участник. */
function serveGroup(myRole: 'owner' | 'member') {
  const calls: string[] = [];
  server.use(
    http.get(api('/chats/:chatId'), ({ params }) =>
      HttpResponse.json({
        chat: {
          id: params.chatId,
          type: 'group',
          title: 'Проект',
          ownerId: myRole === 'owner' ? ME : 'u-anna',
          role: myRole,
        },
      })
    ),
    http.get(api('/chats/:chatId/members'), () =>
      HttpResponse.json({
        members: [
          member(ME, 'me', myRole),
          member('u-anna', 'anna', myRole === 'owner' ? 'member' : 'owner'),
        ],
      })
    ),
    http.get(api('/chats/:chatId/members-online'), () => HttpResponse.json({ members: [ME] })),
    http.post(api('/chats/:chatId/members'), async ({ request }) => {
      const body = (await request.json()) as { userId: string };
      calls.push(`add ${body.userId}`);
      return HttpResponse.json({ success: true });
    }),
    http.get(api('/users/search'), () =>
      HttpResponse.json({
        users: [
          { id: 'u-boris', username: 'boris', firstName: 'Борис', lastName: '', avatarUrl: '' },
          { id: 'u-anna', username: 'anna', firstName: '', lastName: '', avatarUrl: '' },
        ],
      })
    ),
    http.delete(api('/chats/:chatId/members/:userId'), ({ params }) => {
      calls.push(`remove ${String(params.userId)}`);
      return HttpResponse.json({ success: true });
    }),
    http.post(api('/chats/:chatId/leave'), ({ params }) => {
      calls.push(`leave ${String(params.chatId)}`);
      return HttpResponse.json({ success: true });
    })
  );
  return calls;
}

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={['/chats/group-1']}>
          <Routes>
            <Route element={<GroupInfoModal isOpen onClose={() => {}} />} path="/chats/:chatId" />
            <Route element={<p>Список чатов</p>} path="/chats" />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('сведения о группе', () => {
  beforeEach(() => {
    useProfileStore.setState({ user: makeUser({ id: ME }) });
  });

  it('«Удалить» у участника действительно удаляет его', async () => {
    // Раньше нажатие молча глоталось: действие ждало тело запроса,
    // которого у удаления нет.
    const calls = serveGroup('owner');
    renderModal();

    // Участник открывается профилем в той же панели (#822), действия
    // владельца — внизу профиля.
    await userEvent.click(await screen.findByRole('button', { name: /^anna/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить из группы' }));

    await waitFor(() => expect(calls).toEqual(['remove u-anna']));
    // После удаления — обратно к сведениям о группе.
    expect(
      await screen.findByRole('complementary', { name: 'Сведения о группе' })
    ).toBeInTheDocument();
  });

  it('из профиля участника «Назад» возвращает к группе', async () => {
    serveGroup('owner');
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: /^anna/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Назад к сведениям о группе' })
    );

    expect(
      await screen.findByRole('complementary', { name: 'Сведения о группе' })
    ).toBeInTheDocument();
  });

  it('подзаголовок — участники и кто в сети, роли — рядом с именем', async () => {
    serveGroup('owner');
    renderModal();

    expect(await screen.findByText(/^2 участник[а-я]*, 1 в сети$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^me.*владелец/ })).toBeInTheDocument();
  });

  it('добавляет выбранных из поиска, уже вступивших не предлагает', async () => {
    const calls = serveGroup('owner');
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить участников' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Имя или @username' }), 'bo');

    const boris = await screen.findByRole('checkbox', { name: /Борис/ });
    // Анна уже в группе — её в списке нет.
    expect(screen.queryByRole('checkbox', { name: /anna/ })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Выберите, кого добавить' })).toBeDisabled();
    await userEvent.click(boris);
    expect(boris).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Добавить (1)' }));

    await waitFor(() => expect(calls).toEqual(['add u-boris']));
    expect(
      await screen.findByRole('complementary', { name: 'Сведения о группе' })
    ).toBeInTheDocument();
  });

  it('участнику без прав добавлять и управлять нечем', async () => {
    serveGroup('member');
    renderModal();

    await screen.findByRole('complementary', { name: 'Сведения о группе' });
    expect(screen.queryByRole('button', { name: 'Добавить участников' })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /^anna/ }));
    await screen.findByRole('complementary', { name: /Профиль/ });
    expect(screen.queryByRole('button', { name: 'Удалить из группы' })).not.toBeInTheDocument();
    // Блокировка — как в личном профиле, она от прав в группе не зависит.
    expect(screen.getByRole('button', { name: /Заблокировать/ })).toBeInTheDocument();
  });

  it('профиль участника — тот же, что из личного чата: общее из личной переписки', async () => {
    serveGroup('owner');
    server.use(
      http.get(api('/chats'), () =>
        HttpResponse.json({
          chats: [{ id: 'dm-anna', type: 'private', title: 'anna', peerId: 'u-anna' }],
        })
      ),
      http.get(api('/messages/dm-anna'), () => HttpResponse.json({ messages: [] }))
    );
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: /^anna/ }));
    await screen.findByRole('complementary', { name: /Профиль/ });

    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument());
    // Звонки выключены до нового экрана (#776 → #774).
    expect(screen.queryByRole('button', { name: 'Аудиозвонок' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить из группы' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Заблокировать/ })).toBeInTheDocument();
  });

  it('«Покинуть чат» выходит через подтверждение и уводит к списку (#90)', async () => {
    const calls = serveGroup('member');
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Покинуть группу' }));
    // Одно нажатие ещё ничего не делает: сначала подтверждение.
    expect(calls).toEqual([]);

    const dialog = screen.getByRole('alertdialog', { name: 'Покинуть «Проект»?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Покинуть' }));

    await waitFor(() => expect(calls).toEqual(['leave group-1']));
    expect(await screen.findByText('Список чатов')).toBeInTheDocument();
  });
});
