import { testI18n } from '@/test/harness/i18n';
import type { IRichTextInputHandle } from '@/shared/ui';
import { STORAGE_KEYS } from '@/shared/config';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiControl } from './EmojiControl';

function renderControl() {
  const insertText = vi.fn();
  const draftRef = { current: { insertText } as unknown as IRichTextInputHandle };
  render(
    <I18nextProvider i18n={testI18n}>
      <div>
        <EmojiControl draftRef={draftRef} />
        <p>лента</p>
      </div>
    </I18nextProvider>
  );
  return { insertText };
}

/* Панель эмодзи в поле ввода (#824). */
describe('панель эмодзи', () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEYS.RECENT_EMOJI));
  afterEach(() => localStorage.removeItem(STORAGE_KEYS.RECENT_EMOJI));

  it('открывается смайликом: недавние по умолчанию, картинки Noto из статики', async () => {
    renderControl();
    const button = screen.getByRole('button', { name: 'Эмодзи' });

    await userEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('dialog', { name: 'Эмодзи' });
    expect(within(panel).getByRole('tab', { name: 'Недавние' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const thumbsUp = within(panel).getByRole('button', { name: 'класс' });
    expect(thumbsUp.querySelector('img')).toHaveAttribute('src', '/emoji/noto/1f44d.svg');
    expect(within(panel).getByRole('link', { name: 'Noto Emoji' })).toBeInTheDocument();
  });

  it('выбранный встаёт в поле и попадает в недавние первым, панель остаётся', async () => {
    const { insertText } = renderControl();
    await userEvent.click(screen.getByRole('button', { name: 'Эмодзи' }));

    await userEvent.click(screen.getByRole('tab', { name: 'Разное' }));
    await userEvent.click(screen.getByRole('button', { name: 'ракета' }));

    expect(insertText).toHaveBeenCalledWith('🚀');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.RECENT_EMOJI)!)[0]).toBe('🚀');
    expect(screen.getByRole('dialog', { name: 'Эмодзи' })).toBeInTheDocument();
  });

  it('поиск по-русски и по-английски; ничего — «Ничего не нашлось»', async () => {
    renderControl();
    await userEvent.click(screen.getByRole('button', { name: 'Эмодзи' }));
    const search = screen.getByRole('searchbox', { name: 'Поиск эмодзи' });

    await userEvent.type(search, 'пицц');
    expect(screen.getByText('Результаты поиска')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'пицца' })).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'rocket');
    expect(screen.getByRole('button', { name: 'ракета' })).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'жираф');
    expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument();
  });

  it('закрывается Escape с возвратом фокуса и нажатием мимо', async () => {
    renderControl();
    const button = screen.getByRole('button', { name: 'Эмодзи' });

    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Эмодзи' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(screen.getByText('лента'));
    expect(screen.queryByRole('dialog', { name: 'Эмодзи' })).not.toBeInTheDocument();
  });
});
