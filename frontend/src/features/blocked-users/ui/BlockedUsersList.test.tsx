import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { services } from '@/services/serviceContainer';
import { testI18n } from '@/test/harness/i18n';
import { BlockedUsersList } from './BlockedUsersList';

function renderList(onBack = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <BlockedUsersList onBack={onBack} />
      </I18nextProvider>
    </QueryClientProvider>
  );

  return { onBack, queryClient };
}

describe('BlockedUsersList', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('вызывает onBack при нажатии кнопки "Назад"', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([]);
    const onBack = vi.fn();
    const user = userEvent.setup();

    renderList(onBack);

    await user.click(screen.getByRole('button', { name: /назад/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('отображает пустое состояние при отсутствии заблокированных', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([]);

    renderList();

    expect(
      await screen.findByText('В чёрном списке пока никого нет')
    ).toBeInTheDocument();
  });

  it('отображает ошибку с кнопкой повтора', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockRejectedValue(new Error('fail'));

    renderList();

    expect(
      await screen.findByText('Не получилось. Попробуйте ещё раз')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('рендерит список заблокированных и вызывает разблокировку', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'blocked_person',
        firstName: 'Иван',
        lastName: 'Иванов',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);
    vi.spyOn(services.userService, 'unblockUser').mockResolvedValue({ success: true });

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('Иван Иванов')).toBeInTheDocument();
    expect(screen.getByText('@blocked_person')).toBeInTheDocument();

    const unblockBtn = screen.getByRole('button', { name: 'Разблокировать' });
    await user.click(unblockBtn);

    expect(services.userService.unblockUser).toHaveBeenCalledWith('u-1');
  });

  it('отображает инпут поиска независимо от состояния списка', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([]);
    renderList();

    expect(
      screen.getByPlaceholderText('Поиск по заблокированным...')
    ).toBeInTheDocument();
  });

  it('фильтрует заблокированных пользователей по имени и юзернейму', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'alice',
        firstName: 'Алиса',
        lastName: 'Селезнева',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
      {
        id: 'u-2',
        username: 'bob',
        firstName: 'Боб',
        lastName: 'Марли',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('Алиса Селезнева')).toBeInTheDocument();
    expect(screen.getByText('Боб Марли')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Поиск по заблокированным...');
    await user.type(searchInput, 'алис');

    expect(screen.getByText('Алиса Селезнева')).toBeInTheDocument();
    expect(screen.queryByText('Боб Марли')).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'bob');

    expect(screen.queryByText('Алиса Селезнева')).not.toBeInTheDocument();
    expect(screen.getByText('Боб Марли')).toBeInTheDocument();
  });

  it('показывает сообщение "Ничего не найдено", если совпадений нет', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'alice',
        firstName: 'Алиса',
        lastName: '',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('Алиса')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Поиск по заблокированным...');
    await user.type(searchInput, 'несуществующий');

    expect(screen.queryByText('Алиса')).not.toBeInTheDocument();
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
  });

  it('очищает поиск по клику на кнопку очистки', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'alice',
        firstName: 'Алиса',
        lastName: '',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('Алиса')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Поиск по заблокированным...');
    await user.type(searchInput, 'запрос');

    expect(screen.getByDisplayValue('запрос')).toBeInTheDocument();
    const clearBtn = screen.getByRole('button', { name: 'Очистить поиск' });
    await user.click(clearBtn);

    expect(searchInput).toHaveValue('');
    expect(screen.getByText('Алиса')).toBeInTheDocument();
  });
});
