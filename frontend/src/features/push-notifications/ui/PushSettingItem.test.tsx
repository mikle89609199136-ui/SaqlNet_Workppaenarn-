import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { ToastStack } from '@/shared/ui';
import { testI18n } from '@/test/harness/i18n';
import { browserPushDeps, disablePush, usePushStore } from '../model/pushNotifications';
import { PushSettingItem } from './PushSettingItem';

function renderPushSettingItem(props: Parameters<typeof PushSettingItem>[0] = {}) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <PushSettingItem {...props} />
      <ToastStack />
    </I18nextProvider>
  );
}

describe('Переключатель push — мгновенная реакция и откат (#1083)', () => {
  beforeEach(() => {
    usePushStore.setState({ status: 'off', subscriptionId: null, busy: false });
    vi.restoreAllMocks();
  });

  it('визуально переключает тумблер оптимистично до завершения enable', async () => {
    let resolveEnable!: (status: 'on') => void;
    const pendingEnable = new Promise<'on'>((resolve) => {
      resolveEnable = resolve;
    });
    const enableMock = vi.fn().mockImplementation(() => pendingEnable);

    renderPushSettingItem({ enable: enableMock });

    const toggle = screen.getByRole('switch', { name: 'На этом устройстве' });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    // Свитч должен стать checked мгновенно, хотя промис ещё не разрешён
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(enableMock).toHaveBeenCalledTimes(1);

    // Завершаем промис и проверяем, что статус зафиксирован
    resolveEnable('on');
    usePushStore.setState({ status: 'on', subscriptionId: 'sub-1', busy: false });

    await waitFor(() => expect(screen.getByText('Настройки сохранены')).toBeInTheDocument());
    expect(toggle).toBeChecked();
  });

  it('показывает тост «Настройки сохранены» при успешном включении', async () => {
    const enableMock = vi.fn().mockImplementation(async () => {
      usePushStore.setState({ status: 'on', subscriptionId: 'sub-1', busy: false });
      return 'on';
    });

    renderPushSettingItem({ enable: enableMock });

    const toggle = screen.getByRole('switch', { name: 'На этом устройстве' });
    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText('Настройки сохранены')).toBeInTheDocument());
    expect(toggle).toBeChecked();
  });

  it.each(['denied', 'off'] as const)(
    'молча откатывает свитч при отказе или закрытии запроса разрешения (%s)',
    async (status) => {
      const enableMock = vi.fn(async () => {
        usePushStore.setState({ status, subscriptionId: null, busy: false });
        return status;
      });
      renderPushSettingItem({ enable: enableMock });
      const toggle = screen.getByRole('switch', { name: 'На этом устройстве' });
      await userEvent.click(toggle);
      await waitFor(() => expect(toggle).not.toBeChecked());
      expect(screen.queryByText('Не удалось сохранить настройки')).not.toBeInTheDocument();
      expect(screen.queryByText('Настройки сохранены')).not.toBeInTheDocument();
    }
  );

  it('откатывает тумблер и показывает ошибку при сбое в enable', async () => {
    const enableMock = vi.fn().mockRejectedValue(new Error('Network error'));

    renderPushSettingItem({ enable: enableMock });

    const toggle = screen.getByRole('switch', { name: 'На этом устройстве' });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByText('Не удалось сохранить настройки')).toBeInTheDocument()
    );
    expect(toggle).not.toBeChecked();
  });

  it('оптимистично выключает тумблер и показывает тост «Настройки сохранены»', async () => {
    usePushStore.setState({ status: 'on', subscriptionId: 'sub-1', busy: false });

    let resolveDisable!: () => void;
    const pendingDisable = new Promise<void>((resolve) => {
      resolveDisable = resolve;
    });
    const disableMock = vi.fn().mockImplementation(() => pendingDisable);

    renderPushSettingItem({ disable: disableMock });

    const toggle = screen.getByRole('switch', { name: 'На этом устройстве' });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);

    // Свитч должен стать unchecked мгновенно
    expect(toggle).not.toBeChecked();
    expect(disableMock).toHaveBeenCalledTimes(1);

    resolveDisable();
    usePushStore.setState({ status: 'off', subscriptionId: null, busy: false });

    await waitFor(() => expect(screen.getByText('Настройки сохранены')).toBeInTheDocument());
    expect(toggle).not.toBeChecked();
  });
  it('возвращает включённый свитч и ошибку при реальном сбое отключения', async () => {
    usePushStore.setState({ status: 'on', subscriptionId: 'sub-1', busy: false });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderPushSettingItem({
      disable: () =>
        disablePush({
          ...browserPushDeps,
          registration: vi.fn().mockRejectedValue(new Error('service worker failed')),
        }),
    });
    const toggle = screen.getByRole('switch', { name: 'На этом устройстве' });
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByText('Не удалось сохранить настройки')).toBeInTheDocument()
    );
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.queryByText('Настройки сохранены')).not.toBeInTheDocument();
  });
});
