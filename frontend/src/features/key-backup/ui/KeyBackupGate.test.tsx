import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import {
  forgetBackupState,
  PasskeyCancelledError,
  setBackupState,
  WrongCloudPasswordError,
} from '@/shared/crypto';
import { testI18n } from '@/test/harness/i18n';
import { KeyBackupGate } from './KeyBackupGate';

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter>
          <KeyBackupGate onSignOut={() => {}} renderQrLogin={() => <p>вход по коду</p>}>
            <p>приложение</p>
          </KeyBackupGate>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('заслонка резервной копии (#744)', () => {
  beforeEach(() => {
    vi.spyOn(services.cryptoService, 'init').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    forgetBackupState();
  });

  it('пропускает в приложение, когда ключи готовы', () => {
    setBackupState({ status: 'ready', hasPasskey: false, migrating: false });

    renderGate();

    expect(screen.getByText('приложение')).toBeInTheDocument();
  });

  it('не прячет приложение, когда шифрование в браузере невозможно', () => {
    setBackupState({ status: 'unavailable', hasPasskey: false, migrating: false });

    renderGate();

    expect(screen.getByText('приложение')).toBeInTheDocument();
  });

  it('просит задать облачный пароль, если копии нет', () => {
    setBackupState({ status: 'needsSetup', hasPasskey: false, migrating: false });

    renderGate();

    expect(screen.queryByText('приложение')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Облачный пароль' })).toBeInTheDocument();
    expect(screen.getByLabelText('Повторите облачный пароль')).toBeInTheDocument();
  });

  it('предупреждает, что переписка прежней схемы уйдёт в копию', () => {
    setBackupState({ status: 'needsSetup', hasPasskey: false, migrating: true });

    renderGate();

    expect(screen.getByText(/будет сохранена в зашифрованную копию/)).toBeInTheDocument();
  });

  it('говорит о неверном облачном пароле и не пускает дальше', async () => {
    setBackupState({ status: 'locked', hasPasskey: false, migrating: false });
    const unlock = vi
      .spyOn(services.cryptoService, 'unlockWithPassword')
      .mockRejectedValue(new WrongCloudPasswordError());

    renderGate();
    await userEvent.type(screen.getByLabelText('Облачный пароль'), 'не тот пароль');
    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(unlock).toHaveBeenCalledWith('не тот пароль');
    expect(await screen.findByText('Неверный облачный пароль')).toBeInTheDocument();
    expect(screen.queryByText('приложение')).not.toBeInTheDocument();
  });

  it('не показывает вход по passkey, если в копии его нет', () => {
    setBackupState({ status: 'locked', hasPasskey: false, migrating: false });

    renderGate();

    expect(screen.queryByRole('button', { name: 'Открыть с passkey' })).not.toBeInTheDocument();
  });

  it('при отменённом passkey объясняет по-русски, а не текстом браузера (#746)', async () => {
    setBackupState({ status: 'locked', hasPasskey: true, migrating: false });
    vi.stubGlobal('PublicKeyCredential', class {});
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { create: () => Promise.resolve(null), get: () => Promise.resolve(null) },
    });
    vi.spyOn(services.cryptoService, 'unlockWithPasskey').mockRejectedValue(
      new PasskeyCancelledError()
    );

    try {
      renderGate();
      await userEvent.click(screen.getByRole('button', { name: 'Открыть с passkey' }));

      expect(await screen.findByText(/в этом браузере нет passkey/)).toBeInTheDocument();
      expect(screen.queryByText(/timed out or was not allowed/)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'credentials');
    }
  });

  it('сбрасывает копию только после явного подтверждения', async () => {
    setBackupState({ status: 'locked', hasPasskey: false, migrating: false });
    const reset = vi.spyOn(services.cryptoService, 'resetBackup').mockResolvedValue();

    renderGate();
    await userEvent.click(screen.getByRole('button', { name: 'Забыли облачный пароль?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить копию' }));

    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByText(/станет недоступна на всех ваших устройствах/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить и потерять историю' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('предлагает повторить, если проверить ключи не удалось', () => {
    setBackupState({ status: 'error', hasPasskey: false, migrating: false });

    renderGate();

    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
