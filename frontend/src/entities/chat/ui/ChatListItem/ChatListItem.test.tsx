import { testI18n } from '@/test/harness/i18n';
import { makeChat } from '@/test/fixtures';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ChatListItem } from './ChatListItem';

const CHAT_ID = 'chat-open';

const ME = 'user-me';

function renderRow(chat = makeChat({ id: CHAT_ID, title: 'Максим' }), openedPath = '/chats/other') {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MemoryRouter initialEntries={[openedPath]}>
        <ChatListItem chat={chat} currentUserId={ME} />
      </MemoryRouter>
    </I18nextProvider>
  );
}

const last = (overrides: Record<string, unknown>) =>
  ({
    id: 'm-1',
    content: 'привет',
    type: 'text',
    senderId: 'u-2',
    senderName: 'Игорь',
    reactions: [],
    ...overrides,
  }) as never;

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

  /* Состояния строки по ListRow дизайн-системы (#819). */
  describe('состояния по дизайн-системе', () => {
    it('своё последнее сообщение подписано «Вы:»', () => {
      renderRow(
        makeChat({
          id: CHAT_ID,
          title: 'Вася',
          type: 'private',
          lastMessage: last({ senderId: ME }),
        })
      );

      expect(screen.getByText(/Вы: привет/)).toBeInTheDocument();
    });

    it('в группе чужое сообщение подписано именем автора, в личном — нет', () => {
      const { unmount } = renderRow(
        makeChat({ id: CHAT_ID, title: 'Команда', type: 'group', lastMessage: last({}) })
      );
      expect(screen.getByText(/Игорь: привет/)).toBeInTheDocument();
      unmount();

      renderRow(makeChat({ id: CHAT_ID, title: 'Игорь', type: 'private', lastMessage: last({}) }));
      expect(screen.queryByText(/Игорь: привет/)).not.toBeInTheDocument();
      expect(screen.getByText('привет')).toBeInTheDocument();
    });

    it('галочки — только у своего сообщения и только когда сервер прислал статус', () => {
      const { unmount } = renderRow(
        makeChat({
          id: CHAT_ID,
          type: 'private',
          lastMessage: last({ senderId: ME, status: 'read' }),
        })
      );
      expect(screen.getByRole('img', { name: 'Прочитано' })).toHaveClass('text-brand');
      unmount();

      renderRow(makeChat({ id: CHAT_ID, type: 'private', lastMessage: last({ senderId: ME }) }));
      expect(screen.queryByRole('img', { name: /Прочитано|Отправлено/ })).not.toBeInTheDocument();
    });

    it('чат без звука — значок после имени и приглушённый счётчик', () => {
      const { container } = renderRow(
        makeChat({ id: CHAT_ID, title: 'Вася', isMuted: true, unreadCount: 4 })
      );

      expect(screen.getByRole('img', { name: 'Без звука' })).toBeInTheDocument();
      expect(container.querySelector('.bg-muted-badge')).toHaveTextContent('4');
    });

    it('отмеченный непрочитанным вручную — пустой кружок с подписью для диктора', () => {
      renderRow(makeChat({ id: CHAT_ID, title: 'Вася', isMarkedUnread: true, unreadCount: 0 }));

      expect(screen.getByRole('link')).toHaveAccessibleName(/Отмечен непрочитанным/);
    });

    it('булавка — у закреплённого без непрочитанных, иначе её место у счётчика', () => {
      const { unmount } = renderRow(makeChat({ id: CHAT_ID, isPinned: true, unreadCount: 0 }));
      expect(screen.getByRole('img', { name: 'Закреплён' })).toBeInTheDocument();
      unmount();

      renderRow(makeChat({ id: CHAT_ID, isPinned: true, unreadCount: 2 }));
      expect(screen.queryByRole('img', { name: 'Закреплён' })).not.toBeInTheDocument();
    });

    it('у открытого чата счётчика нет, строка залита акцентом', () => {
      renderRow(makeChat({ id: CHAT_ID, title: 'Вася', unreadCount: 5 }), `/chats/${CHAT_ID}`);

      const link = screen.getByRole('link');
      expect(link).not.toHaveAccessibleName(/непрочитанных/);
      expect(link).toHaveClass('aria-[current=page]:bg-brand-fill');
    });
  });
});
