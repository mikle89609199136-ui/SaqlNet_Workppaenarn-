import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatKeys, readDraft, writeDraft } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { queryClient } from '@/shared/api';
import { getToasts } from '@/shared/ui';
import { createTestQueryClient, renderSettings } from '@/test/harness/renderSettings';

/**
 * Раздел «Аккаунт»: выход и завершение сеансов.
 *
 * Проверяется не «нажалось ли», а что нельзя выйти случайно и что после
 * выхода в памяти вкладки не остаётся чужой переписки.
 */
describe('выход из аккаунта', () => {
  it('спрашивает подтверждение', async () => {
    const logout = vi.spyOn(services.authService, 'logout');

    renderSettings({ section: 'account' });

    await userEvent.click(await screen.findByRole('button', { name: /Выйти из аккаунта/ }));

    expect(await screen.findByRole('dialog', { name: 'Выйти из аккаунта?' })).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    logout.mockRestore();
  });

  it('чистит кеш запросов, чтобы чужие сообщения не остались в памяти', async () => {
    const logout = vi.spyOn(services.authService, 'logout').mockResolvedValue(undefined as never);

    // Общий клиент приложения: его и чистит выход, в приложении он один.
    queryClient.setQueryData(chatKeys.messages('chat-1'), {
      pages: [[{ id: 'm1' }]],
      pageParams: [0],
    });

    renderSettings({ queryClient, section: 'account' });

    await userEvent.click(await screen.findByRole('button', { name: /Выйти из аккаунта/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    // Запрет из docs/frontend-data-architecture.md.
    await waitFor(() =>
      expect(queryClient.getQueryData(chatKeys.messages('chat-1'))).toBeUndefined()
    );
    // И уводит на вход: остаться в настройках без аккаунта нельзя.
    expect(await screen.findByText('Вход')).toBeInTheDocument();

    logout.mockRestore();
  });

  it('предупреждает, что завершение сеансов стирает ключи', async () => {
    const wipeDevice = vi.spyOn(services.cryptoService, 'wipeDevice');

    renderSettings({ section: 'account', subsection: 'sessions' });

    await userEvent.click(await screen.findByRole('button', { name: 'Завершить все сеансы' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Завершить все сеансы?' });
    expect(dialog).toHaveTextContent('ключи шифрования');
    // Пока не подтвердили — ключи на месте.
    expect(wipeDevice).not.toHaveBeenCalled();

    wipeDevice.mockRestore();
  });

  it('отмена оставляет сеансы и ключи нетронутыми', async () => {
    const logoutAll = vi.spyOn(services.authService, 'logoutAll');
    const wipeDevice = vi.spyOn(services.cryptoService, 'wipeDevice');

    renderSettings({ section: 'account', subsection: 'sessions' });

    await userEvent.click(await screen.findByRole('button', { name: 'Завершить все сеансы' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(logoutAll).not.toHaveBeenCalled();
    expect(wipeDevice).not.toHaveBeenCalled();

    logoutAll.mockRestore();
    wipeDevice.mockRestore();
  });

  it('не стирает ключи и показывает ошибку, если сервер не отозвал сеансы', async () => {
    const logoutAll = vi
      .spyOn(services.authService, 'logoutAll')
      .mockRejectedValue(new Error('logout-all unavailable'));
    const wipeDevice = vi.spyOn(services.cryptoService, 'wipeDevice');
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(chatKeys.messages('chat-1'), {
      pages: [[{ id: 'm1' }]],
      pageParams: [0],
    });

    renderSettings({ queryClient, section: 'account', subsection: 'sessions' });

    await userEvent.click(await screen.findByRole('button', { name: 'Завершить все сеансы' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить сеансы' }));

    expect(
      await screen.findByText(/Другие устройства всё ещё могут иметь доступ/)
    ).toBeInTheDocument();
    expect(wipeDevice).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(chatKeys.messages('chat-1'))).toBeDefined();
    expect(screen.queryByText('Вход')).not.toBeInTheDocument();

    logoutAll.mockRestore();
    wipeDevice.mockRestore();
  });
});

/* Выход очищает вкладку целиком (#1072): прежде AuthService сам стирал
   профиль, и общая очистка после этого ничего не делала — черновики,
   переводы и ключи в памяти доставались следующему, кто войдёт. */
describe('выход очищает вкладку', () => {
  afterEach(() => vi.restoreAllMocks());

  it('«Выйти» — черновики стёрты, профиль снят, на экране вход', async () => {
    vi.spyOn(services.authService, 'logout').mockResolvedValue(undefined as never);
    writeDraft('chat-1', 'недописанное');

    renderSettings({ queryClient, section: 'account' });
    await userEvent.click(await screen.findByRole('button', { name: /Выйти из аккаунта/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    expect(await screen.findByText('Вход')).toBeInTheDocument();
    expect(readDraft('chat-1')).toBe('');
    expect(useProfileStore.getState().isAuth).toBe(false);
    expect(getToasts()).toEqual([]);
  });

  it('сервер не ответил — вкладка всё равно очищена, и человек об этом знает', async () => {
    vi.spyOn(services.authService, 'logout').mockRejectedValue(new TypeError('Failed to fetch'));
    writeDraft('chat-1', 'недописанное');

    renderSettings({ queryClient, section: 'account' });
    await userEvent.click(await screen.findByRole('button', { name: /Выйти из аккаунта/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    expect(await screen.findByText('Вход')).toBeInTheDocument();
    expect(readDraft('chat-1')).toBe('');
    expect(getToasts()).toEqual([
      expect.objectContaining({
        message: 'Сервер не ответил — выход выполнен только на этом устройстве',
      }),
    ]);
  });

  it('«Завершить все сеансы» — ключи стираются до очистки профиля, черновики тоже', async () => {
    vi.spyOn(services.authService, 'logoutAll').mockResolvedValue(undefined as never);
    let signedInDuringWipe: boolean | null = null;
    vi.spyOn(services.cryptoService, 'wipeDevice').mockImplementation(async () => {
      signedInDuringWipe = useProfileStore.getState().isAuth;
    });
    writeDraft('chat-1', 'недописанное');

    renderSettings({ queryClient, section: 'account', subsection: 'sessions' });
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить все сеансы' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить сеансы' }));

    expect(await screen.findByText('Вход')).toBeInTheDocument();
    expect(signedInDuringWipe).toBe(true);
    expect(readDraft('chat-1')).toBe('');
    expect(useProfileStore.getState().isAuth).toBe(false);
  });

  it('«Завершить все сеансы» не удалось — черновик на месте', async () => {
    vi.spyOn(services.authService, 'logoutAll').mockRejectedValue(new Error('unavailable'));
    writeDraft('chat-1', 'недописанное');

    renderSettings({ queryClient, section: 'account', subsection: 'sessions' });
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить все сеансы' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить сеансы' }));

    expect(
      await screen.findByText(/Другие устройства всё ещё могут иметь доступ/)
    ).toBeInTheDocument();
    expect(readDraft('chat-1')).toBe('недописанное');
    expect(useProfileStore.getState().isAuth).toBe(true);
  });
});
