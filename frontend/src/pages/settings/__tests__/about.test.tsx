import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/shared/config';
import { services } from '@/services/serviceContainer';
import { createTestQueryClient, renderSettings } from '@/test/harness/renderSettings';
import { userKeys } from '@/entities/user';

/**
 * Раздел «О приложении».
 *
 * Здесь единственное необратимое действие во всех настройках, поэтому
 * проверяется не «нажалось ли», а что нельзя стереть ключи случайно.
 */
describe('о приложении', () => {
  it('не стирает ключи без подтверждения', async () => {
    const wipeDevice = vi.spyOn(services.cryptoService, 'wipeDevice');

    renderSettings({ section: 'about' });

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    // Окно открылось — но пока человек не подтвердил, ничего не произошло.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(wipeDevice).not.toHaveBeenCalled();

    wipeDevice.mockRestore();
  });

  it('отмена оставляет ключи на месте', async () => {
    const wipeDevice = vi.spyOn(services.cryptoService, 'wipeDevice');

    renderSettings({ section: 'about' });

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(wipeDevice).not.toHaveBeenCalled();

    wipeDevice.mockRestore();
  });

  it('после стирания чистит кеш запросов', async () => {
    const wipeDevice = vi
      .spyOn(services.cryptoService, 'wipeDevice')
      .mockResolvedValue(undefined as never);

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(userKeys.settings(), { settings: {}, privacy: {} });

    renderSettings({ queryClient, section: 'about' });

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить ключи' }));

    await waitFor(() => expect(wipeDevice).toHaveBeenCalledOnce());

    /* Ключей больше нет, но расшифрованные сообщения остались бы в памяти
       вкладки до перезагрузки — тот же запрет, что при выходе. */
    await waitFor(() => expect(queryClient.getQueryData(userKeys.settings())).toBeUndefined());

    wipeDevice.mockRestore();
  });

  it('показывает версию из сборки', async () => {
    renderSettings({ section: 'about' });

    expect(await screen.findByText(APP_VERSION)).toBeInTheDocument();
  });
});
