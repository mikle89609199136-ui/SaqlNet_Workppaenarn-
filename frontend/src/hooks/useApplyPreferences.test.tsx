import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { STORAGE_KEYS } from '@/consts';
import { testI18n } from '@/test/harness/i18n';
import { userKeys } from '@/queries/keys';
import { useApplyPreferences } from './useApplyPreferences';

function Probe() {
  useApplyPreferences();
  return null;
}

function renderWithSettings(settings: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(userKeys.settings(), { settings, privacy: {} });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <Probe />
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('применение темы и языка', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('ставит выбранную тему на документ', async () => {
    renderWithSettings({ theme: 'light' });

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
  });

  it('сохраняет проекцию, чтобы тема применилась до загрузки настроек', async () => {
    renderWithSettings({ theme: 'light' });

    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      expect(raw && JSON.parse(raw)).toEqual({ theme: 'light' });
    });
  });

  it('переключает язык интерфейса', async () => {
    renderWithSettings({ language: 'en' });

    await waitFor(() => expect(testI18n.language).toBe('en'));
    expect(document.documentElement.lang).toBe('en');
  });

  it('ничего не трогает, пока настройки не загружены', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={testI18n}>
          <Probe />
        </I18nextProvider>
      </QueryClientProvider>
    );

    // Значение по умолчанию задано в index.html и должно пережить запуск без
    // сессии: на странице входа настроек ещё нет.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBeNull();
  });
});
