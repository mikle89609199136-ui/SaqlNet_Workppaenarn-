import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/queries/keys';
import { services } from '@/services/serviceContainer';
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

    const queryClient = createTestQueryClient();
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

    logout.mockRestore();
  });

  it('предупреждает, что завершение сеансов стирает ключи', async () => {
    const wipeDevice = vi.spyOn(services.cryptoService, 'wipeDevice');

    renderSettings({ section: 'account', subsection: 'sessions' });

    await userEvent.click(await screen.findByRole('button', { name: 'Завершить все сеансы' }));

    const dialog = await screen.findByRole('dialog', { name: 'Завершить все сеансы?' });
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

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(logoutAll).not.toHaveBeenCalled();
    expect(wipeDevice).not.toHaveBeenCalled();

    logoutAll.mockRestore();
    wipeDevice.mockRestore();
  });
});
