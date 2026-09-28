import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { clearToasts, getToasts } from '@/shared/ui';
import { makeChat } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { BlockUserButton } from './BlockUserButton';
import { BlockedUsersManager } from './BlockedUsersManager';

const anna = {
  id: 'user-anna',
  username: 'anna',
  firstName: 'Анна',
  lastName: '',
  avatarUrl: '',
  blockedAt: '2026-09-26T12:00:00Z',
};

function renderWith(ui: React.ReactElement, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

/** Сервер с настоящим состоянием: блокировка добавляет в список, снятие — убирает. */
function serveBlocked(initial: (typeof anna)[]) {
  let blocked = [...initial];
  const calls: string[] = [];
  server.use(
    // Пустой список сервер отдаёт как null — так он и приходит на деле.
    http.get(api('/users/blocked'), () =>
      HttpResponse.json({ blocked: blocked.length ? blocked : null })
    ),
    http.post(api('/users/blocked'), async ({ request }) => {
      const { userId } = (await request.json()) as { userId: string };
      calls.push(`block ${userId}`);
      blocked = [...blocked, { ...anna, id: userId }];
      return HttpResponse.json({ success: true }, { status: 201 });
    }),
    http.delete(api('/users/blocked/:userId'), ({ params }) => {
      calls.push(`unblock ${String(params.userId)}`);
      blocked = blocked.filter((user) => user.id !== params.userId);
      return HttpResponse.json({ success: true });
    })
  );
  return calls;
}

async function confirmBlock() {
  const dialog = screen.getByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Заблокировать' }));
}

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clearToasts();
});

describe('кнопка в профиле (#727)', () => {
  it('блокирует после подтверждения и сразу предлагает разблокировать', async () => {
    const calls = serveBlocked([]);
    renderWith(<BlockUserButton name="Анна" userId="user-anna" />, client);

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }));
    // Без подтверждения ничего не происходит.
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Заблокировать Анна?');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('не сможет писать вам и звонить');
    expect(calls).toEqual([]);

    await confirmBlock();

    expect(await screen.findByRole('button', { name: 'Разблокировать' })).toBeInTheDocument();
    expect(calls).toEqual(['block user-anna']);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('отмена в диалоге ничего не блокирует', async () => {
    const calls = serveBlocked([]);
    renderWith(<BlockUserButton name="Анна" userId="user-anna" />, client);

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /отмена/i })
    );

    expect(calls).toEqual([]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('разблокирует без подтверждения', async () => {
    const calls = serveBlocked([anna]);
    renderWith(<BlockUserButton name="Анна" userId="user-anna" />, client);

    await userEvent.click(await screen.findByRole('button', { name: 'Разблокировать' }));

    expect(await screen.findByRole('button', { name: 'Заблокировать' })).toBeInTheDocument();
    expect(calls).toEqual(['unblock user-anna']);
  });

  it('«уже заблокирован» — не ошибка: кнопка просто меняется', async () => {
    let blocked: (typeof anna)[] = [];
    server.use(
      http.get(api('/users/blocked'), () => HttpResponse.json({ blocked })),
      http.post(api('/users/blocked'), () => {
        blocked = [anna];
        return HttpResponse.json(
          { code: 'already_blocked', message: 'user is already blocked' },
          { status: 409 }
        );
      })
    );
    renderWith(<BlockUserButton name="Анна" userId="user-anna" />, client);

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }));
    await confirmBlock();

    expect(await screen.findByRole('button', { name: 'Разблокировать' })).toBeInTheDocument();
    expect(getToasts()).toEqual([]);
  });

  it('ошибка сервера — сообщение, кнопка остаётся', async () => {
    serveBlocked([]);
    server.use(
      http.post(api('/users/blocked'), () =>
        HttpResponse.json({ code: 'user_not_found', message: 'user not found' }, { status: 404 })
      )
    );
    renderWith(<BlockUserButton name="Анна" userId="user-anna" />, client);

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }));
    await confirmBlock();

    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0].type).toBe('error');
    expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeInTheDocument();
  });

  it('блокировка перечитывает личный чат только с этим человеком', async () => {
    serveBlocked([]);
    client.setQueryData(
      chatKeys.detail('chat-anna'),
      makeChat({ id: 'chat-anna', type: 'private', peerId: 'user-anna' })
    );
    client.setQueryData(
      chatKeys.detail('chat-boris'),
      makeChat({ id: 'chat-boris', type: 'private', peerId: 'user-boris' })
    );
    renderWith(<BlockUserButton name="Анна" userId="user-anna" />, client);

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }));
    await confirmBlock();

    await waitFor(() =>
      expect(client.getQueryState(chatKeys.detail('chat-anna'))?.isInvalidated).toBe(true)
    );
    expect(client.getQueryState(chatKeys.detail('chat-boris'))?.isInvalidated).toBe(false);
  });
});

describe('экран «Чёрный список» (#727)', () => {
  it('показывает заблокированных и разблокирует из списка', async () => {
    const calls = serveBlocked([anna]);
    renderWith(<BlockedUsersManager onBack={vi.fn()} />, client);

    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('@anna')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Разблокировать' }));

    expect(await screen.findByText('Вы никого не заблокировали')).toBeInTheDocument();
    expect(calls).toEqual(['unblock user-anna']);
  });

  it('поиск по имени и логину, в том числе с «@» (идея из #761)', async () => {
    serveBlocked([
      anna,
      { ...anna, id: 'user-boris', username: 'bob77', firstName: 'Борис', lastName: 'Петров' },
    ]);
    renderWith(<BlockedUsersManager onBack={vi.fn()} />, client);
    const search = await screen.findByRole('searchbox', { name: 'Поиск в чёрном списке' });

    await userEvent.type(search, 'петр');
    expect(screen.getByText('Борис Петров')).toBeInTheDocument();
    expect(screen.queryByText('Анна')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, '@anna');
    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.queryByText('Борис Петров')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'никто');
    expect(screen.getByText('Никого не нашлось')).toBeInTheDocument();
  });

  it('пустой список — без поля поиска', async () => {
    serveBlocked([]);
    renderWith(<BlockedUsersManager onBack={vi.fn()} />, client);

    expect(await screen.findByText('Вы никого не заблокировали')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('пустой список — понятная надпись, а не пустота', async () => {
    serveBlocked([]);
    renderWith(<BlockedUsersManager onBack={vi.fn()} />, client);

    expect(await screen.findByText('Вы никого не заблокировали')).toBeInTheDocument();
  });

  it('ошибка загрузки — баннер, а не «никого не заблокировали»', async () => {
    server.use(http.get(api('/users/blocked'), () => HttpResponse.json({}, { status: 500 })));
    renderWith(<BlockedUsersManager onBack={vi.fn()} />, client);

    expect(await screen.findByText(/Не удалось загрузить чёрный список/)).toBeInTheDocument();
    expect(screen.queryByText('Вы никого не заблокировали')).not.toBeInTheDocument();
  });

  it('«Назад» возвращает к настройкам', async () => {
    serveBlocked([]);
    const onBack = vi.fn();
    renderWith(<BlockedUsersManager onBack={onBack} />, client);

    await userEvent.click(screen.getByRole('button', { name: 'Назад' }));

    expect(onBack).toHaveBeenCalled();
  });
});
