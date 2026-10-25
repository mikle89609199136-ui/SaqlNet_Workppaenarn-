import { testI18n } from '@/test/harness/i18n';
import { makeChat } from '@/test/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAllDrafts, writeDraft } from '../../model/chatDraftsStore';
import { useTypingStore } from '../../model/typingStore';
import { ChatListItem } from './ChatListItem';

const CHAT_ID = 'chat-open';

const ME = 'user-me';

function renderRow(chat = makeChat({ id: CHAT_ID, title: 'Максим' }), openedPath = '/chats/other') {
  // Подпись «кто печатает» ищет имя в кеше запросов (#837).
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={[openedPath]}>
          <ChatListItem chat={chat} currentUserId={ME} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  // Стор общий для всех тестов (isolate: false).
  act(() => useTypingStore.getState().clearTyping(CHAT_ID));
  clearAllDrafts();
});

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

    it('галочки своего последнего в личном чате: отправлено, доставлено, прочитано (#657)', () => {
      const at = '2026-09-29T12:00:00.000Z';
      // Второй цвет — на открытом чате, где строка залита акцентом: там
      // «доставлено» и «прочитано» тоже должны различаться.
      const cases = [
        [
          last({ senderId: ME }),
          'Отправлено',
          'text-ink-3',
          'group-aria-[current=page]:text-out-tick',
        ],
        [
          last({ senderId: ME, deliveredAt: at }),
          'Доставлено',
          'text-ink-3',
          'group-aria-[current=page]:text-out-tick',
        ],
        [
          last({ senderId: ME, deliveredAt: at, readAt: at }),
          'Прочитано',
          'text-brand',
          'group-aria-[current=page]:text-out-read',
        ],
      ] as const;

      for (const [lastMessage, label, color, currentColor] of cases) {
        const { unmount } = renderRow(makeChat({ id: CHAT_ID, type: 'private', lastMessage }));
        expect(screen.getByRole('img', { name: label })).toHaveClass(color, currentColor);
        unmount();
      }
    });

    it('у чужого последнего галочек нет, в группе своё — только «отправлено»', () => {
      const at = '2026-09-29T12:00:00.000Z';
      const { unmount } = renderRow(
        makeChat({ id: CHAT_ID, type: 'private', lastMessage: last({ readAt: at }) })
      );
      expect(screen.queryByRole('img', { name: /Прочитано|Доставлено|Отправлено/ })).toBeNull();
      unmount();

      renderRow(
        makeChat({ id: CHAT_ID, type: 'group', lastMessage: last({ senderId: ME, readAt: at }) })
      );
      expect(screen.getByRole('img', { name: 'Отправлено' })).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Прочитано' })).toBeNull();
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

  describe('кто печатает (#837)', () => {
    it('в группе — имя печатающего вместо превью, цветом акцента', () => {
      renderRow(makeChat({ id: CHAT_ID, type: 'group', title: 'Команда', lastMessage: last({}) }));

      act(() => useTypingStore.getState().setTyping(CHAT_ID, 'u-3', 'Маша'));

      const label = screen.getByText('Маша печатает…');
      expect(label).toHaveClass('text-brand');
      expect(screen.queryByText('привет')).not.toBeInTheDocument();
    });

    it('имя без запросов: автор последнего сообщения известен по строке', () => {
      renderRow(makeChat({ id: CHAT_ID, type: 'group', title: 'Команда', lastMessage: last({}) }));

      act(() => useTypingStore.getState().setTyping(CHAT_ID, 'u-2'));

      expect(screen.getByText('Игорь печатает…')).toBeInTheDocument();
    });

    it('двое и незнакомый участник', () => {
      renderRow(makeChat({ id: CHAT_ID, type: 'group', title: 'Команда' }));

      act(() => useTypingStore.getState().setTyping(CHAT_ID, 'stranger'));
      expect(screen.getByText('Участник печатает…')).toBeInTheDocument();

      act(() => {
        useTypingStore.getState().setTyping(CHAT_ID, 'u-3', 'Маша');
        useTypingStore.getState().setTyping(CHAT_ID, 'u-4', 'Вера');
      });
      expect(screen.getByText('3 участника печатают…')).toBeInTheDocument();
    });

    it('в личном чате — без имени', () => {
      renderRow(makeChat({ id: CHAT_ID, type: 'private', title: 'Игорь' }));

      act(() => useTypingStore.getState().setTyping(CHAT_ID, 'u-2', 'Игорь'));

      expect(screen.getByText('печатает...')).toBeInTheDocument();
    });
  });

  describe('форматирование в превью (#971)', () => {
    it('рендерит форматирование (strong) в последнем сообщении', () => {
      const { container } = renderRow(
        makeChat({
          id: CHAT_ID,
          title: 'Команда',
          lastMessage: last({
            content: 'важное сообщение',
            entities: [{ type: 'bold', offset: 0, length: 6 }],
          }),
        })
      );

      const strong = container.querySelector('strong');
      expect(strong).toBeInTheDocument();
      expect(strong).toHaveTextContent('важное');
    });

    it('рендерит форматирование (em) в черновике после задержки набора', () => {
      vi.useFakeTimers();
      try {
        const { container } = renderRow(makeChat({ id: CHAT_ID, title: 'Команда' }));

        act(() => {
          writeDraft(CHAT_ID, {
            text: 'мой черновик',
            entities: [{ type: 'italic', offset: 4, length: 8 }],
          });
          vi.advanceTimersByTime(500);
        });

        const em = container.querySelector('em');
        expect(em).toBeInTheDocument();
        expect(em).toHaveTextContent('черновик');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

/* Звонок в превью (#1073): тип и итог, без «Вы:» и галочек — направление
   уже в подписи, а «прочитано» у звонка смысла не имеет. */
describe('звонок последним сообщением', () => {
  const callContent = (fields: Record<string, unknown>) => JSON.stringify(fields);

  it('чужой пропущенный — «Пропущенный звонок»', () => {
    renderRow(
      makeChat({
        id: CHAT_ID,
        title: 'Максим',
        type: 'private',
        lastMessage: last({
          type: 'call',
          senderId: 'u-2',
          content: callContent({ callKind: 'audio', status: 'missed', initiatorId: 'u-2' }),
        }),
      })
    );

    expect(screen.getByText('Пропущенный звонок')).toBeInTheDocument();
  });

  it('свой отвеченный — «Исходящий звонок · 1:05», без «Вы:» и галочек', () => {
    const { container } = renderRow(
      makeChat({
        id: CHAT_ID,
        title: 'Максим',
        type: 'private',
        lastMessage: last({
          type: 'call',
          senderId: ME,
          content: callContent({
            callKind: 'audio',
            status: 'answered',
            duration: 65,
            initiatorId: ME,
          }),
          readAt: '2026-10-17T10:00:00Z',
        }),
      })
    );

    expect(screen.getByText('Исходящий звонок · 1:05')).toBeInTheDocument();
    expect(screen.queryByText(/Вы:/)).toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
  });

  it('своё текстовое — по-прежнему с «Вы:»', () => {
    renderRow(
      makeChat({
        id: CHAT_ID,
        title: 'Максим',
        type: 'private',
        lastMessage: last({ senderId: ME, content: 'до завтра' }),
      })
    );

    expect(screen.getByText(/Вы:/)).toBeInTheDocument();
  });
});

/* «Избранное» в списке (#1075): значок, название из словаря, без «Вы:»
   и галочек — всё своё, и читать его некому. */
describe('строка «Избранного»', () => {
  it('значок и «Избранное», без «Вы:», галочек и буквы', () => {
    const { container } = renderRow(
      makeChat({
        id: CHAT_ID,
        title: 'Избранное',
        type: 'self',
        peerId: undefined,
        lastMessage: last({ senderId: ME, content: 'купить хлеб', readAt: '2026-10-17T10:00:00Z' }),
      } as never)
    );

    expect(screen.getByText('Избранное')).toBeInTheDocument();
    expect(screen.getByText('купить хлеб')).toBeInTheDocument();
    expect(screen.queryByText(/Вы:/)).toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
