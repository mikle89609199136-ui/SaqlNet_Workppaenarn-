import { testI18n } from '@/test/harness/i18n';
import { makeChat } from '@/test/fixtures';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ChatListItem } from './ChatListItem';

const CHAT_ID = 'chat-open';

function renderRow(chat = makeChat({ id: CHAT_ID, title: 'Максим' }), openedPath = '/chats/other') {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MemoryRouter initialEntries={[openedPath]}>
        <ChatListItem chat={chat} />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('строка списка чатов', () => {
  it('помечает открытый чат для диктора и для стилей', () => {
    renderRow(undefined, `/chats/${CHAT_ID}`);

    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'page');
  });

  it('не помечает чат, который сейчас не открыт', () => {
    renderRow();

    expect(screen.getByRole('link')).not.toHaveAttribute('aria-current');
  });

  it('называет ссылку всем содержимым строки, а не одним заголовком', () => {
    /* Прежде на ссылке стоял aria-label с названием чата: он заменяет
       собой содержимое, и диктор объявлял только «Максим». */
    const chat = makeChat({
      id: CHAT_ID,
      title: 'Максим',
      unreadCount: 3,
      lastMessage: { content: 'привет', type: 'text' } as never,
    });

    renderRow(chat);

    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(/Максим/);
    expect(link).toHaveAccessibleName(/3 непрочитанных/);
  });

  it('отдаёт время машиночитаемым', () => {
    const lastMessageAt = new Date('2026-09-01T10:15:00.000Z');
    const chat = makeChat({ id: CHAT_ID, title: 'Максим', lastMessageAt });

    renderRow(chat);

    expect(screen.getByText(/./, { selector: 'time' })).toHaveAttribute(
      'datetime',
      lastMessageAt.toISOString()
    );
  });
});
