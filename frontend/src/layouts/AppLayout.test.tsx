import { testI18n } from '@/test/harness/i18n';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

/** Ширину окна решает `matchMedia`: его и подменяем. */
function setScreen(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as never;
}

function renderLayout() {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MemoryRouter initialEntries={['/chats']}>
        <AppLayout />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('навигация приложения', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('на телефоне есть вход в настройки', () => {
    /* До этого попасть в них с телефона было нельзя вовсе: бургер и
       настройки добавлялись только в широкую раскладку. */
    setScreen(true);
    renderLayout();

    const настройки = screen.getByRole('link', { name: /Настройки/i });
    expect(настройки).toHaveAttribute('href', '/settings');
  });

  it('на телефоне пять разделов', () => {
    setScreen(true);
    renderLayout();

    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('на широком экране настройки не задваиваются', () => {
    /* Там для них есть своё место внизу рельса, поэтому пункт из общего
       списка отсекается. */
    setScreen(false);
    renderLayout();

    const ссылки = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/settings');

    expect(ссылки).toHaveLength(1);
  });
});
