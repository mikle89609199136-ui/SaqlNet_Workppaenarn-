import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { SettingsSearch } from '../ui/SettingsSearch';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderSearch() {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MemoryRouter>
        <SettingsSearch />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('SettingsSearch (#1082)', () => {
  it('отображает кнопку очистки с cursor-pointer при вводе текста и очищает поле по клику', async () => {
    const user = userEvent.setup();
    renderSearch();

    const input = screen.getByRole('textbox', { name: 'Поиск по настройкам' });
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();

    await user.type(input, 'пароль');
    expect(input).toHaveValue('пароль');

    const clearButton = screen.getByRole('button', { name: 'Очистить поиск' });
    expect(clearButton).toBeInTheDocument();
    expect(clearButton).toHaveClass('cursor-pointer', 'active:layer-press');

    await user.click(clearButton);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();
  });

  it('результаты поиска имеют стили cursor-pointer, hover и active', async () => {
    const user = userEvent.setup();
    renderSearch();

    const input = screen.getByRole('textbox', { name: 'Поиск по настройкам' });
    await user.type(input, 'пароль');

    const resultButtons = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('aria-label') !== 'Очистить поиск'
    );
    expect(resultButtons.length).toBeGreaterThan(0);

    const firstResult = resultButtons[0];
    expect(firstResult).toHaveClass('cursor-pointer');
    expect(firstResult).toHaveClass('hover:bg-sheet-2');
    expect(firstResult).toHaveClass('active:bg-sheet-3', 'active:layer-press');
  });
});
