import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProfileStore } from '@/entities/user';
import { makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { useMessageSearchStore } from '../model/messageSearchStore';
import { MessageSearchResults } from './MessageSearchResults';

const results = [
  makeMessage({ id: 'r1', senderId: 'u-2', senderName: 'Вася', content: 'перед созвоном проверь' }),
  makeMessage({ id: 'r2', senderId: 'me', content: 'созвон перенесли' }),
];

function renderPanel() {
  render(
    <I18nextProvider i18n={testI18n}>
      <MessageSearchResults />
    </I18nextProvider>
  );
  return screen.getByRole('region', { name: 'Найдено в чате' });
}

describe('панель «Найдено в чате» (#841)', () => {
  beforeEach(() => {
    useProfileStore.setState({ user: makeUser({ id: 'me' }) });
    const store = useMessageSearchStore.getState();
    store.open('chat-1');
    store.setQuery('созвон');
    store.setResults(results, false);
  });

  it('число найденного, заметка о приватности и авторы — свои как «Вы»', () => {
    const panel = renderPanel();

    expect(within(panel).getByText('2')).toBeInTheDocument();
    expect(within(panel).getByText(/Сервер не видит ни переписку, ни запрос/)).toBeInTheDocument();
    const rows = within(panel).getAllByRole('button', { name: /созвон/i });
    expect(rows[0]).toHaveTextContent('Вася');
    expect(rows[1]).toHaveTextContent('Вы');
  });

  it('текущее выделено строкой и ярче подсвечено; нажатие делает строку текущей', () => {
    const panel = renderPanel();
    const [first, second] = within(panel).getAllByRole('button', { name: /созвон/i });

    expect(first).toHaveAttribute('aria-current', 'true');
    expect(first.querySelector('mark')).toHaveAttribute('data-current', 'true');

    fireEvent.click(second);

    expect(second).toHaveAttribute('aria-current', 'true');
    expect(useMessageSearchStore.getState().currentIndex).toBe(1);
  });
});
