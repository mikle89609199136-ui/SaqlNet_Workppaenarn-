import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { testI18n } from '@/test/harness/i18n';
import { ReactionAuthorsModal } from './ReactionAuthorsModal';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('ReactionAuthorsModal (#998)', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
    vi.restoreAllMocks();
  });

  it('не рендерится, если окно закрыто в store', () => {
    renderWithProviders(<ReactionAuthorsModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('отображает список авторов для одиночной реакции', async () => {
    vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValue({
      emoji: '👍',
      total: 1,
      users: [
        {
          id: 'u-1',
          firstName: 'Алексей',
          lastName: 'Смирнов',
          username: 'alex',
          avatarUrl: undefined,
        },
      ],
      nextCursor: undefined,
    });

    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      chatId: 'chat-1',
      initialEmoji: '👍',
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });

    renderWithProviders(<ReactionAuthorsModal />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Реакции')).toBeInTheDocument();
    expect(screen.getByTestId('reaction-authors-list')).toHaveClass('min-h-[280px]');

    await waitFor(() => {
      expect(screen.getByText('Алексей Смирнов')).toBeInTheDocument();
      expect(screen.getByText('@alex')).toBeInTheDocument();
    });
  });

  it('показывает табы для нескольких реакций и переключает их', async () => {
    const listSpy = vi
      .spyOn(services.messageService, 'listReactionAuthors')
      .mockImplementation(async (_msgId, emoji) => {
        if (emoji === '👍') {
          return {
            emoji: '👍',
            total: 1,
            users: [{ id: 'u-1', firstName: 'Алексей', lastName: 'Иванов', username: 'alex' }],
          };
        }
        return {
          emoji: '❤️',
          total: 1,
          users: [{ id: 'u-2', firstName: 'Мария', lastName: 'Петрова', username: 'maria' }],
        };
      });

    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      chatId: 'chat-1',
      initialEmoji: 'all',
      reactions: [
        { emoji: '👍', count: 2, myReaction: false },
        { emoji: '❤️', count: 3, myReaction: false },
      ],
    });

    renderWithProviders(<ReactionAuthorsModal />);

    // Проверяем наличие табов
    expect(screen.getByText('Все')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // total

    // Во вкладке «Все» видны оба автора
    await waitFor(() => {
      expect(screen.getByText('Алексей Иванов')).toBeInTheDocument();
      expect(screen.getByText('Мария Петрова')).toBeInTheDocument();
    });

    // Переключаемся на таб с сердцем (счётчик 3)
    const heartTab = screen.getByText('3').closest('button')!;
    fireEvent.click(heartTab);

    await waitFor(() => {
      expect(screen.getByText('Мария Петрова')).toBeInTheDocument();
      expect(screen.queryByText('Алексей Иванов')).toBeNull();
    });

    listSpy.mockRestore();
  });

  it('клик по автору вызывает переход в профиль и закрывает окно', async () => {
    vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValue({
      emoji: '👍',
      total: 1,
      users: [{ id: 'u-1', firstName: 'Иван', lastName: 'Сидоров', username: 'ivan' }],
    });

    const onSelectUser = vi.fn();

    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      chatId: 'chat-1',
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });

    renderWithProviders(<ReactionAuthorsModal onSelectUser={onSelectUser} />);

    await waitFor(() => {
      expect(screen.getByText('Иван Сидоров')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Иван Сидоров'));

    expect(onSelectUser).toHaveBeenCalledWith('u-1');
    expect(useChatUiStore.getState().reactionAuthorsModal).toBeNull();
  });

  it('закрывается по кнопке закрытия', async () => {
    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });

    renderWithProviders(<ReactionAuthorsModal />);

    const closeBtn = screen.getByLabelText('Закрыть');
    fireEvent.click(closeBtn);

    expect(useChatUiStore.getState().reactionAuthorsModal).toBeNull();
  });

  it('отображает скелетоны во время загрузки авторов', () => {
    vi.spyOn(services.messageService, 'listReactionAuthors').mockReturnValue(new Promise(() => {}));

    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });

    renderWithProviders(<ReactionAuthorsModal />);

    expect(screen.getByTestId('reaction-authors-skeleton')).toBeInTheDocument();
  });

  it('отображает заглушку пустого списка, если авторы не найдены', async () => {
    vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValue({
      emoji: '👍',
      total: 0,
      users: [],
    });

    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });

    renderWithProviders(<ReactionAuthorsModal />);

    await waitFor(() => {
      expect(screen.getByText('Никто ещё не поставил эту реакцию')).toBeInTheDocument();
    });
  });

  it('показывает отметку "(Вы)" для текущего пользователя', async () => {
    vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValue({
      emoji: '👍',
      total: 1,
      users: [{ id: 'user-me', firstName: 'Александр', lastName: 'Пушкин' }],
    });

    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-1',
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });

    renderWithProviders(<ReactionAuthorsModal currentUserId="user-me" />);

    await waitFor(() => {
      expect(screen.getByText('Александр Пушкин')).toBeInTheDocument();
      expect(screen.getByText('(Вы)')).toBeInTheDocument();
    });
  });
});

describe('пагинация всех реакций и ошибки', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
    vi.restoreAllMocks();
  });
  it('догружает cursor для каждого emoji во вкладке Все', async () => {
    const request = vi
      .spyOn(services.messageService, 'listReactionAuthors')
      .mockImplementation(async (_id, emoji, cursor) => ({
        emoji,
        total: 2,
        users: [
          {
            id: cursor ? 'second' : 'first',
            firstName: cursor ? 'Борис' : 'Анна',
            lastName: emoji,
            username: 'author',
          },
        ],
        nextCursor: !cursor ? 'next-page' : undefined,
      }));
    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-pages',
      initialEmoji: 'all',
      reactions: [
        { emoji: '👍', count: 2, myReaction: false },
        { emoji: '❤️', count: 2, myReaction: false },
      ],
    });
    renderWithProviders(<ReactionAuthorsModal />);
    await screen.findByText('Анна 👍');
    fireEvent.click(await screen.findByRole('button', { name: 'Загрузить ещё 👍' }));
    expect(await screen.findByText('Борис 👍')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('msg-pages', '👍', 'next-page', 50);
    expect(screen.getByRole('button', { name: 'Загрузить ещё ❤️' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '❤️ 2' }));
    expect(screen.queryByText('Борис 👍')).not.toBeInTheDocument();
    expect(screen.getByText('Анна ❤️')).toBeInTheDocument();
  });
  it.each(['all', '👍'])('показывает ошибку и retry во вкладке %s', async (initialEmoji) => {
    vi.spyOn(services.messageService, 'listReactionAuthors')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ emoji: '👍', total: 0, users: [] });
    useChatUiStore.getState().setReactionAuthorsModal({
      messageId: 'msg-error',
      initialEmoji,
      reactions: [{ emoji: '👍', count: 1, myReaction: false }],
    });
    renderWithProviders(<ReactionAuthorsModal />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить авторов');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Никто ещё не поставил эту реакцию')).toBeInTheDocument();
  });
});
