import { testI18n } from '@/test/harness/i18n';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
        <Routes>
          <Route element={<AppLayout />}>
            <Route element={<p>Содержимое раздела</p>} path="/chats" />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

/* Разделы — вкладки списка чатов, настройки — кнопка в его шапке (#818).
   Каркасу остаётся только фон окна и место под содержимое. */
describe('каркас приложения', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['на телефоне', true],
    ['на широком экране', false],
  ])('%s нет ни боковой, ни нижней навигации', (_, mobile) => {
    setScreen(mobile);
    renderLayout();

    expect(screen.getByText('Содержимое раздела')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
