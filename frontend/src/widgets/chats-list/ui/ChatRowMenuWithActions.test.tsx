import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys, type IChatDto } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { ChatRowMenu } from '@/features/chat-actions';
import { clearToasts, getToasts } from '@/shared/ui';
import { makeChat, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ChatRowMenuWithActions } from './ChatRowMenuWithActions';

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

/* Роутер нужен выходу из группы: с открытого экрана вышедшей группы он
   уводит к списку чатов. */
function renderWith(ui: React.ReactElement, { path = '/chats' } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={[path]}>
          {ui}
          <Location />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return client;
}

const menuProps = (chat: IChatDto, onClose = vi.fn()) => ({
  chat,
  onClose,
  pinnedCount: 0,
  returnFocusRef: createRef<HTMLElement>(),
  x: 0,
  y: 0,
});

const privateChat = (extra: Partial<IChatDto> = {}) =>
  makeChat({ id: 'chat-1', type: 'private', peerId: 'user-peer', title: 'Борис', ...extra });

describe('пункт блокировки в меню строки чата (#727)', () => {
  it('без действия блокировки пункта нет', () => {
    renderWith(<ChatRowMenu {...menuProps(privateChat())} />);

    expect(screen.queryByRole('menuitem', { name: 'Заблокировать' })).not.toBeInTheDocument();
  });

  it('«Заблокировать» не закрывает меню само — это сделает подтверждение', async () => {
    const onBlock = vi.fn();
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenu {...props} block={{ blocked: false, onBlock, onUnblock: vi.fn() }} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));

    expect(onBlock).toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('«Разблокировать» снимает блокировку и закрывает меню', async () => {
    const onUnblock = vi.fn();
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenu {...props} block={{ blocked: true, onBlock: vi.fn(), onUnblock }} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Разблокировать' }));

    expect(onUnblock).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('меню строки чата вместе с блокировкой (виджет)', () => {
  it('блокирует после подтверждения; меню прячется на время диалога', async () => {
    const blocked: string[] = [];
    server.use(
      http.post(api('/users/blocked'), async ({ request }) => {
        blocked.push(((await request.json()) as { userId: string }).userId);
        return HttpResponse.json({ success: true }, { status: 201 });
      })
    );
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenuWithActions {...props} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Заблокировать Борис?');
    expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Заблокировать' }));

    await waitFor(() => expect(blocked).toEqual(['user-peer']));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it('отмена в диалоге закрывает всё без блокировки', async () => {
    const blocked: string[] = [];
    server.use(
      http.post(api('/users/blocked'), () => {
        blocked.push('x');
        return HttpResponse.json({ success: true }, { status: 201 });
      })
    );
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenuWithActions {...props} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /отмена/i })
    );

    expect(props.onClose).toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it('заблокированный — «Разблокировать», признак берётся из самого чата', async () => {
    const unblocked: string[] = [];
    server.use(
      http.delete(api('/users/blocked/:userId'), ({ params }) => {
        unblocked.push(String(params.userId));
        return HttpResponse.json({ success: true });
      })
    );
    renderWith(<ChatRowMenuWithActions {...menuProps(privateChat({ isPeerBlocked: true }))} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Разблокировать' }));

    await waitFor(() => expect(unblocked).toEqual(['user-peer']));
  });

  it('в группе блокировать некого — пункта нет', () => {
    renderWith(<ChatRowMenuWithActions {...menuProps(makeChat({ type: 'group' }))} />);

    expect(screen.queryByRole('menuitem', { name: 'Заблокировать' })).not.toBeInTheDocument();
  });
});

const ME = 'user-me';

const member = (id: string, firstName: string, role: string) => ({
  id,
  username: firstName.toLowerCase(),
  firstName,
  lastName: '',
  avatarUrl: '',
  role,
  permissions: {},
  joinedAt: '2026-09-01T00:00:00Z',
});

const groupChat = (extra: Partial<IChatDto> = {}) =>
  makeChat({ id: 'group-1', type: 'group', title: 'Проект', peerId: undefined, ...extra });

/** Сервер выхода из группы: записывает, что и в каком порядке у него просили. */
function serveLeave({
  members = [] as ReturnType<typeof member>[],
  leaveStatus = 200,
  leaveCode = '',
} = {}) {
  const calls: string[] = [];
  server.use(
    http.get(api('/chats/:chatId/members'), () => HttpResponse.json({ members })),
    http.post(api('/chats/:chatId/transfer-ownership'), async ({ params, request }) => {
      const { userId } = (await request.json()) as { userId: string };
      calls.push(`transfer ${String(params.chatId)} ${userId}`);
      return HttpResponse.json({ success: true });
    }),
    http.post(api('/chats/:chatId/leave'), ({ params }) => {
      calls.push(`leave ${String(params.chatId)}`);
      return leaveStatus === 200
        ? HttpResponse.json({ success: true })
        : HttpResponse.json({ code: leaveCode, message: 'x' }, { status: leaveStatus });
    }),
    http.delete(api('/chats/:chatId'), ({ params }) => {
      calls.push(`delete ${String(params.chatId)}`);
      return HttpResponse.json({ success: true });
    })
  );
  return calls;
}

const openLeave = () => userEvent.click(screen.getByRole('menuitem', { name: 'Покинуть группу' }));

const confirmIn = (name: string) =>
  userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name }));

describe('выход из группы из меню строки чата (#90)', () => {
  beforeEach(() => {
    useProfileStore.setState({ user: makeUser({ id: ME }) });
    clearToasts();
  });

  it('у личного чата пункта нет', () => {
    renderWith(<ChatRowMenuWithActions {...menuProps(privateChat())} />);

    expect(screen.queryByRole('menuitem', { name: 'Покинуть группу' })).not.toBeInTheDocument();
  });

  it('участник выходит после подтверждения, группа пропадает из кеша', async () => {
    const calls = serveLeave();
    const props = menuProps(groupChat());
    const client = renderWith(<ChatRowMenuWithActions {...props} />);
    client.setQueryData(chatKeys.detail('group-1'), groupChat());

    await openLeave();

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Покинуть «Проект»?');
    expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).not.toBeInTheDocument();

    await confirmIn('Покинуть');

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(calls).toEqual(['leave group-1']);
    expect(client.getQueryData(chatKeys.detail('group-1'))).toBeUndefined();
    // Экран этой группы не был открыт — уводить некуда и незачем.
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/chats$/);
  });

  it('с открытого экрана этой группы уводит к списку чатов', async () => {
    serveLeave();
    renderWith(<ChatRowMenuWithActions {...menuProps(groupChat())} />, { path: '/chats/group-1' });

    await openLeave();
    await confirmIn('Покинуть');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/chats$/));
  });

  it('владелец передаёт группу выбранному и только потом выходит', async () => {
    const calls = serveLeave({
      members: [
        member(ME, 'Я', 'owner'),
        member('u-anna', 'Анна', 'member'),
        member('u-boris', 'Борис', 'admin'),
      ],
    });
    renderWith(<ChatRowMenuWithActions {...menuProps(groupChat({ role: 'owner' }))} />);

    await openLeave();
    const dialog = screen.getByRole('alertdialog');

    // Себя в списке нет; админ стоит первым и уже отмечен.
    expect(await within(dialog).findByRole('radio', { name: 'Борис · админ' })).toBeChecked();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2);

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Анна' }));
    await confirmIn('Передать и выйти');

    await waitFor(() => expect(calls).toEqual(['transfer group-1 u-anna', 'leave group-1']));
  });

  it('владельцу, которому некому передать группу, предлагает только удалить её', async () => {
    const calls = serveLeave({ members: [member(ME, 'Я', 'owner')] });
    renderWith(<ChatRowMenuWithActions {...menuProps(groupChat({ role: 'owner' }))} />);

    await openLeave();
    await within(screen.getByRole('alertdialog')).findByRole('button', { name: 'Удалить группу' });
    await confirmIn('Удалить группу');

    await waitFor(() => expect(calls).toEqual(['delete group-1']));
  });

  it('если роль в списке устарела, по ответу сервера переходит к выбору преемника', async () => {
    const calls = serveLeave({
      members: [member(ME, 'Я', 'owner'), member('u-anna', 'Анна', 'member')],
      leaveStatus: 409,
      leaveCode: 'ownership_transfer_required',
    });
    renderWith(<ChatRowMenuWithActions {...menuProps(groupChat({ role: 'member' }))} />);

    await openLeave();
    await confirmIn('Покинуть');

    expect(await screen.findByRole('radio', { name: 'Анна' })).toBeChecked();
    expect(calls).toEqual(['leave group-1']);
    expect(getToasts()).toEqual([]);
  });

  it('сбой выхода показывает причину и оставляет группу на месте', async () => {
    serveLeave({ leaveStatus: 500 });
    const props = menuProps(groupChat());
    const client = renderWith(<ChatRowMenuWithActions {...props} />);
    client.setQueryData(chatKeys.detail('group-1'), groupChat());

    await openLeave();
    await confirmIn('Покинуть');

    await waitFor(() =>
      expect(getToasts()).toEqual([
        expect.objectContaining({ type: 'error', message: 'Не удалось покинуть чат' }),
      ])
    );
    expect(props.onClose).toHaveBeenCalled();
    expect(client.getQueryData(chatKeys.detail('group-1'))).toBeDefined();
  });
});
