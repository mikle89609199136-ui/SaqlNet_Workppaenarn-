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

    const anna = (await screen.findByText('anna')).closest('li')!;
    await userEvent.click(within(anna).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(calls).toEqual(['remove u-anna']));
  });

  it('«Покинуть чат» выходит через подтверждение и уводит к списку (#90)', async () => {
    const calls = serveGroup('member');
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Покинуть чат' }));
    // Одно нажатие ещё ничего не делает: сначала подтверждение.
    expect(calls).toEqual([]);

    const dialog = screen.getByRole('alertdialog', { name: 'Покинуть «Проект»?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Покинуть' }));

    await waitFor(() => expect(calls).toEqual(['leave group-1']));
    expect(await screen.findByText('Список чатов')).toBeInTheDocument();
  });
});
