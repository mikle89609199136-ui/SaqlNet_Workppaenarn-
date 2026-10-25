import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { act, cleanup } from '@testing-library/react';
import { afterEach, vi, beforeEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { STORAGE_KEYS } from '@/shared/config';
import { testI18n } from '@/test/harness/i18n';
import { userKeys } from './userKeys';
import { makeUser } from '@/test/fixtures';
import { useProfileStore } from './profileStore';
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

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <Probe />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return { ...rendered, queryClient };
}

describe('применение темы и языка', () => {
  beforeEach(() => {
    localStorage.clear();
    useProfileStore.setState({ user: makeUser({ id: 'owner' }) });
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
      expect(raw && JSON.parse(raw)).toMatchObject({
        ownerId: 'owner',
        theme: 'light',
        palette: 'graphite',
        accentPreset: 'violet',
        textSize: 'medium',
        chatDensity: 'normal',
      });
    });
  });

  it('переключает язык интерфейса', async () => {
    renderWithSettings({ language: 'en' });

    await waitFor(() => expect(testI18n.language).toBe('en'));
    expect(document.documentElement.lang).toBe('en');
  });

  it('поздний словарь прежнего языка не отменяет новый выбор', async () => {
    await testI18n.changeLanguage('ru');
    let finish!: () => void;
    const old = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(testI18n, 'loadLanguages').mockReturnValueOnce(old).mockResolvedValue(undefined);
    const change = vi.spyOn(testI18n, 'changeLanguage');
    const { queryClient } = renderWithSettings({ language: 'en' });
    act(() =>
      queryClient.setQueryData(userKeys.settings(), { settings: { language: 'ru' }, privacy: {} })
    );
    await waitFor(() => expect(document.documentElement.lang).toBe('ru'));
    await act(async () => {
      finish();
      await old;
    });
    expect(change).not.toHaveBeenCalledWith('en');
    expect(testI18n.language).toBe('ru');
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('system следует ОС, но в проекции остаётся system; listener удаляется', async () => {
    let dark = false;
    const listeners = new Set<() => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      () =>
        ({
          get matches() {
            return dark;
          },
          addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
          removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
        }) as unknown as MediaQueryList
    );
    const rendered = renderWithSettings({
      theme: 'system',
      palette: 'warm',
      accentPreset: 'teal',
      textSize: 'large',
      chatDensity: 'compact',
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-text-size', 'large');
    expect(document.documentElement).toHaveAttribute('data-chat-density', 'compact');
    act(() => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toMatchObject({
      theme: 'system',
    });
    act(() =>
      rendered.queryClient.setQueryData(userKeys.settings(), {
        settings: { theme: 'light' },
        privacy: {},
      })
    );
    await waitFor(() => expect(listeners.size).toBe(0));
    act(() => {
      dark = false;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    rendered.unmount();
  });

  it('выход удаляет проекцию владельца и сбрасывает оформление', () => {
    renderWithSettings({ theme: 'light', palette: 'warm', textSize: 'large' });
    act(() => useProfileStore.getState().clearProfile());
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBeNull();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).not.toHaveAttribute('data-palette');
  });
});
