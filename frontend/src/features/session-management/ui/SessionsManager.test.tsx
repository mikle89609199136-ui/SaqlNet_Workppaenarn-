import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { createTestQueryClient, renderSettings } from '@/test/harness/renderSettings';
import { chatKeys, clearAllDrafts, readDraft, writeDraft } from '@/entities/chat';
import { userKeys, useProfileStore } from '@/entities/user';
import { makeUser } from '@/test/fixtures';
import type { TAuthSession } from '../model/useSessionActions';

const row = (id: string, isCurrent = false, extra: Partial<TAuthSession> = {}): TAuthSession => ({
  id,
  isCurrent,
  deviceName: id,
  deviceType: 'desktop',
  ipAddress: '192.0.2.1',
  location: 'Москва',
  userAgent: 'Browser',
  createdAt: '2026-09-01T00:00:00Z',
  lastActive: '2026-10-23T09:45:00Z',
  ...extra,
});
const own = row('Этот компьютер', true),
  phone = row('Телефон', false, { deviceType: 'mobile' }),
  tablet = row('Планшет', false, { deviceType: 'tablet' });
let rows: TAuthSession[];
let reads: number;
beforeEach(() => {
  rows = [phone, own, tablet];
  reads = 0;
  server.use(
    http.get(api('/auth/sessions'), () => {
      reads++;
      return HttpResponse.json({ sessions: rows });
    })
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  clearAllDrafts();
});
function show() {
  const client = createTestQueryClient();
  renderSettings({ queryClient: client, section: 'account', subsection: 'sessions' });
  return client;
}
const end = (name: string) => screen.getByRole('button', { name: `Завершить сеанс: ${name}` });
async function confirm(name = 'Телефон') {
  await userEvent.click(end(name));
  const dialog = await screen.findByRole('alertdialog', { name: `Завершить сеанс «${name}»?` });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Завершить сеанс' }));
}

it('uses isCurrent even when the current row is not first; shows metadata and no action for it', async () => {
  show();
  const current = await screen.findByRole('region', { name: 'Это устройство' });
  expect(current).toHaveTextContent('Этот компьютер');
  expect(within(current).queryByRole('button')).not.toBeInTheDocument();
  const other = screen.getByRole('region', { name: 'Другие сеансы' });
  expect(other).toHaveTextContent('Телефон');
  expect(other).toHaveTextContent('Планшет');
  expect(other).toHaveTextContent('телефон');
  expect(other).toHaveTextContent('планшет');
  expect(other).toHaveTextContent(new Date(phone.lastActive).toLocaleString('ru'));
  expect(other).not.toHaveTextContent(new Date(phone.createdAt).toLocaleString('ru'));
  expect(other).toHaveTextContent('192.0.2.1');
});

it('requests confirmation for the selected device; cancel and Escape send no revoke', async () => {
  const remove = vi.spyOn(services.userService, 'deleteDevice');
  show();
  await screen.findByText('Телефон');
  await userEvent.click(end('Телефон'));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('локальные ключи шифрования сохранятся');
  expect(remove).not.toHaveBeenCalled();
  fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  await userEvent.click(end('Телефон'));
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(remove).not.toHaveBeenCalled();
});

it('revokes only the selected ID, refetches and preserves current keys, draft, profile and other caches', async () => {
  const removed: string[] = [];
  server.use(
    http.delete(api('/users/devices/:id'), ({ params }) => {
      removed.push(String(params.id));
      rows = rows.filter((item) => item.id !== params.id);
      return HttpResponse.json({ success: true });
    })
  );
  const wipe = vi.spyOn(services.cryptoService, 'wipeDevice');
  const forget = vi.spyOn(services.cryptoService, 'forgetSession');
  const logout = vi.spyOn(services.authService, 'logoutAll');
  const client = show();
  writeDraft('chat', 'черновик');
  client.setQueryData(chatKeys.messages('chat'), { pages: [[]], pageParams: [0] });
  await screen.findByText('Телефон');
  const initialReads = reads;
  await confirm();
  await waitFor(() => expect(screen.queryByText('Телефон')).not.toBeInTheDocument());
  expect(removed).toEqual(['Телефон']);
  expect(screen.getByText('Планшет')).toBeInTheDocument();
  expect(screen.getByText('Этот компьютер')).toBeInTheDocument();
  await waitFor(() => expect(reads).toBeGreaterThan(initialReads));
  expect(wipe).not.toHaveBeenCalled();
  expect(forget).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  expect(useProfileStore.getState().isAuth).toBe(true);
  expect(readDraft('chat')).toBe('черновик');
  expect(client.getQueryData(chatKeys.messages('chat'))).toBeDefined();
});

it('keeps the row until confirmation from server and prevents duplicate requests and competing actions', async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let requests = 0;
  server.use(
    http.delete(api('/users/devices/:id'), async () => {
      requests++;
      await done;
      rows = rows.filter((row) => row.id !== phone.id);
      return HttpResponse.json({ success: true });
    })
  );
  show();
  await screen.findByText('Телефон');
  await userEvent.click(end('Телефон'));
  const button = within(screen.getByRole('alertdialog')).getByRole('button', {
    name: 'Завершить сеанс',
  });
  await userEvent.dblClick(button);
  await waitFor(() => expect(requests).toBe(1));
  expect(screen.getByText('Телефон')).toBeInTheDocument();
  expect(end('Планшет')).toBeDisabled();
  expect(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' })
  ).toBeDisabled();
  fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  await act(async () => {
    finish();
    await done;
  });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(requests).toBe(1);
});

it('ends others through terminate-all while preserving this session and its E2E keys', async () => {
  let requests = 0;
  server.use(
    http.post(api('/users/devices/terminate-all'), () => {
      requests++;
      rows = rows.filter((row) => row.isCurrent);
      return HttpResponse.json({ success: true });
    })
  );
  const wipe = vi.spyOn(services.cryptoService, 'wipeDevice'),
    logout = vi.spyOn(services.authService, 'logoutAll');
  show();
  writeDraft('chat', 'черновик');
  await userEvent.click(await screen.findByRole('button', { name: 'Завершить все, кроме этого' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Завершить все остальные сеансы?' });
  expect(requests).toBe(0);
  expect(dialog).toHaveTextContent('Это устройство продолжит работу');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Завершить остальные' }));
  await screen.findByText('Других активных сеансов нет.');
  expect(requests).toBe(1);
  expect(wipe).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  expect(useProfileStore.getState().isAuth).toBe(true);
  expect(readDraft('chat')).toBe('черновик');
});

it.each([
  [404, 'Этот сеанс уже завершён или больше недоступен.', true],
  [
    409,
    'Это текущий сеанс. Для выхода используйте «Выйти из аккаунта» в разделе «Аккаунт».',
    false,
  ],
  [500, 'Не удалось завершить выбранные сеансы. Проверьте соединение и повторите попытку.', false],
] as const)(
  'handles HTTP %s without falsely claiming revocation',
  async (status, message, gone) => {
    server.use(
      http.delete(api('/users/devices/:id'), () => {
        if (gone) rows = rows.filter((row) => row.id !== phone.id);
        return HttpResponse.json(
          { code: status === 409 ? 'conflict_current_session' : 'not_found' },
          { status }
        );
      })
    );
    const wipe = vi.spyOn(services.cryptoService, 'wipeDevice');
    show();
    await screen.findByText('Телефон');
    const initial = reads;
    await confirm();
    await screen.findByText(message);
    await waitFor(() => expect(reads).toBeGreaterThan(initial));
    if (gone) expect(screen.queryByText('Телефон')).not.toBeInTheDocument();
    else expect(screen.getByText('Телефон')).toBeInTheDocument();
    expect(wipe).not.toHaveBeenCalled();
    expect(useProfileStore.getState().isAuth).toBe(true);
  }
);

it('distinguishes a successful revoke from a failed list refresh and allows retry without another DELETE', async () => {
  let canRead = true,
    deleted = 0;
  server.use(
    http.get(api('/auth/sessions'), () =>
      canRead ? HttpResponse.json({ sessions: rows }) : HttpResponse.json({}, { status: 500 })
    ),
    http.delete(api('/users/devices/:id'), () => {
      deleted++;
      rows = rows.filter((row) => row.id !== phone.id);
      canRead = false;
      return HttpResponse.json({ success: true });
    })
  );
  show();
  await screen.findByText('Телефон');
  await confirm();
  await screen.findByText(
    'Сеансы завершены, но обновить список не удалось. Повторите загрузку списка.'
  );
  expect(screen.queryByText('Телефон')).not.toBeInTheDocument();
  expect(deleted).toBe(1);
  canRead = true;
  await userEvent.click(await screen.findByRole('button', { name: 'Обновить' }));
  await waitFor(() =>
    expect(screen.queryByText(/Сеансы завершены, но обновить/)).not.toBeInTheDocument()
  );
  expect(deleted).toBe(1);
  expect(screen.getByText('Этот компьютер')).toBeInTheDocument();
});

it('shows load failure and retries rather than claiming an empty list', async () => {
  let fail = true;
  server.use(
    http.get(api('/auth/sessions'), () =>
      fail ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json({ sessions: rows })
    )
  );
  show();
  await screen.findByText(/Не удалось получить список устройств/);
  expect(screen.queryByText(/Активные сеансы не найдены/)).not.toBeInTheDocument();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  await screen.findByText('Телефон');
});

it('401 uses auth cleanup and sign-in flow without erasing device keys', async () => {
  server.use(
    http.delete(api('/users/devices/:id'), () =>
      HttpResponse.json({ code: 'token_revoked' }, { status: 401 })
    )
  );
  const wipe = vi.spyOn(services.cryptoService, 'wipeDevice');
  show();
  await screen.findByText('Телефон');
  await confirm();
  await screen.findByText('Вход');
  expect(useProfileStore.getState().isAuth).toBe(false);
  expect(wipe).not.toHaveBeenCalled();
});

it('late response of a previous account cannot change the new list or close its confirmation', async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let nextOwner = false;
  const b = row('Устройство Боба', false);
  server.use(
    http.get(api('/auth/sessions'), () => HttpResponse.json({ sessions: nextOwner ? [b] : rows })),
    http.delete(api('/users/devices/:id'), async () => {
      await done;
      return HttpResponse.json({ success: true });
    })
  );
  const client = show();
  await screen.findByText('Телефон');
  await confirm();
  nextOwner = true;
  act(() => useProfileStore.setState({ user: makeUser({ id: 'bob' }), isAuth: true }));
  await screen.findByText('Устройство Боба');
  await userEvent.click(end('Устройство Боба'));
  await screen.findByRole('alertdialog', { name: 'Завершить сеанс «Устройство Боба»?' });
  await act(async () => {
    finish();
    await done;
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(client.getQueryData<TAuthSession[]>(userKeys.sessions())).toEqual([b]);
  expect(
    screen.getByRole('alertdialog', { name: 'Завершить сеанс «Устройство Боба»?' })
  ).toBeInTheDocument();
});

it('does not infer current/other identity when isCurrent is missing, and handles invalid activity dates', async () => {
  rows = [
    row('Старое устройство', false, {
      lastActive: 'bad date',
      ipAddress: 'Unknown',
      location: 'Unknown',
      isCurrent: undefined as unknown as boolean,
    }),
  ];
  show();
  await screen.findByText('Старое устройство');
  expect(screen.getByText(/Последняя активность: нет данных/)).toBeInTheDocument();
  expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Это устройство' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Завершить сеанс:/ })).not.toBeInTheDocument();
});

it('a failed terminate-others call preserves the list, current login and local keys', async () => {
  server.use(
    http.post(api('/users/devices/terminate-all'), () =>
      HttpResponse.json({ code: 'internal_error' }, { status: 500 })
    )
  );
  const wipe = vi.spyOn(services.cryptoService, 'wipeDevice');
  const logout = vi.spyOn(services.authService, 'logoutAll');
  show();
  await userEvent.click(await screen.findByRole('button', { name: 'Завершить все, кроме этого' }));
  await userEvent.click(screen.getByRole('button', { name: 'Завершить остальные' }));
  await screen.findByText(
    'Не удалось завершить выбранные сеансы. Проверьте соединение и повторите попытку.'
  );
  expect(screen.getByText('Телефон', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('Этот компьютер', { exact: true })).toBeInTheDocument();
  expect(useProfileStore.getState().isAuth).toBe(true);
  expect(wipe).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
});
