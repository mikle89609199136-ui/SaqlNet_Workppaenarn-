import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/shared/config/routes';
import { testI18n } from '@/test/harness/i18n';
import { SettingsSidebar } from '../ui/SettingsSidebar';
import { SettingsPage } from '../ui/SettingsPage';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('Навигация настроек — широкая зона клика шапки (#1083)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('SettingsSidebar: заголовок «Настройки» и стрелка назад находятся внутри единой ссылки к чатам', async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[ROUTES.SETTINGS]}>
        <Routes>
          <Route path={ROUTES.SETTINGS} element={<SettingsSidebar />} />
          <Route path={ROUTES.CHATS} element={<div>Список чатов</div>} />
        </Routes>
      </MemoryRouter>
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Настройки' });
    const link = heading.closest('a');

    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', ROUTES.CHATS);
    expect(link).toHaveAccessibleName('Назад к чатам: Настройки');
    await userEvent.click(heading);
    expect(screen.getByText('Список чатов')).toBeInTheDocument();
  });

  it('SettingsPage: заголовок подраздела и стрелка назад объединены в единую ссылку возврата', async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/settings/account/profile']}>
        <Routes>
          <Route path="/settings/:section/:subsection?" element={<SettingsPage />} />
          <Route path="/settings/account" element={<div>Раздел аккаунта</div>} />
        </Routes>
      </MemoryRouter>
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Изменить профиль' });
    const link = heading.closest('a');

    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/settings/account');
    expect(link).toHaveAccessibleName('Назад: Аккаунт: Изменить профиль');
    await userEvent.click(heading);
    expect(screen.getByText('Раздел аккаунта')).toBeInTheDocument();
  });
});
