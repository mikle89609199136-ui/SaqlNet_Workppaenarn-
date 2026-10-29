import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeMessage, makePin, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { chatKeys } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from '@/entities/user';
import { PinnedMessagesView } from './PinnedMessagesView';

const CHAT_ID = 'chat-1';

function renderView(
  props: Partial<React.ComponentProps<typeof PinnedMessagesView>> = {},
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  const chat = makeChat({ id: CHAT_ID, title: 'Тестовый чат' });
  queryClient.setQueryData(chatKeys.detail(CHAT_ID), chat);

  const defaultProps: React.ComponentProps<typeof PinnedMessagesView> = {
    pinnedMessages: [],
    onClose: vi.fn(),
    isLoading: false,
    error: '',
    openedImage: null,
    setOpenedImage: vi.fn(),
    onSelection: vi.fn(),
    actionMenu: null,
    setIsForwardModalOpen: vi.fn(),
    setPinnedMessagesOpen: vi.fn(),
    ...props,
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={[`/chats/${CHAT_ID}`]}>
          <Routes>
            <Route path="/chats/:chatId" element={<PinnedMessagesView {...defaultProps} />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('PinnedMessagesView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProfileStore.getState().setUser(makeUser({ id: 'user-1' }));
  });

  it('помечает личный pin в панели', () => {
    const pin = makePin({
      message: makeMessage({ isPinned: false, isChatPinned: false, isPersonalPinned: true }),
    });
    renderView({ pinnedMessages: [pin] });
    expect(screen.getByRole('img', { name: 'Личное закрепление' })).toBeInTheDocument();
  });
  it('ошибка списка не маскируется закрытием пустой панели', () => {
    const onClose = vi.fn();
    renderView({ pinnedMessages: [], error: 'Нет доступа к закреплениям', onClose });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Нет доступа к закреплениям')).toBeInTheDocument();
  });

  it('should auto-close when no pinned messages remain', () => {
    const onClose = vi.fn();
    renderView({ pinnedMessages: [], onClose, isLoading: false });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should render exactly one back button in header', () => {
    const onClose = vi.fn();
    const pin = makePin({ message: makeMessage({ content: 'Сообщение' }) });

    renderView({ pinnedMessages: [pin], onClose });

    const backButtons = screen.getAllByRole('button', { name: 'Назад' });
    expect(backButtons).toHaveLength(1);
    expect(screen.getByRole('banner')).toHaveClass('px-1.5');
    expect(screen.getByRole('banner')).not.toHaveClass('md:px-3');

    fireEvent.click(backButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should render messages list and unpin all button when messages exist', () => {
    const pin = makePin({
      message: makeMessage({ id: 'msg-1', content: 'Текст закрепления' }),
    });

    renderView({ pinnedMessages: [pin] });

    expect(screen.getByText('Текст закрепления')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Открепить всё' })).toBeInTheDocument();
  });

  it('should show confirm dialog when clicking unpin all and cancel without unpinning', () => {
    const pin1 = makePin({ message: makeMessage({ id: 'msg-1' }) });
    const pin2 = makePin({ message: makeMessage({ id: 'msg-2' }) });
    const setPinnedMessagesOpen = vi.fn();

    renderView({
      pinnedMessages: [pin1, pin2],
      setPinnedMessagesOpen,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Открепить всё' }));

    expect(screen.getByText('Открепить все сообщения?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Личные закрепления исчезнут только у вас; общие — у всех, если у вас есть права. Собеседники сохранят свои личные закрепления.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(setPinnedMessagesOpen).not.toHaveBeenCalled();
  });

  it('should unpin all messages when confirmed in dialog', async () => {
    const pin1 = makePin({ message: makeMessage({ id: 'msg-1' }) });
    const pin2 = makePin({ message: makeMessage({ id: 'msg-2' }) });
    const setPinnedMessagesOpen = vi.fn();
    vi.spyOn(services.messageService, 'unpinMessage').mockResolvedValue({} as any);

    renderView({
      pinnedMessages: [pin1, pin2],
      setPinnedMessagesOpen,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Открепить всё' }));

    const unpinButtons = screen.getAllByRole('button', { name: 'Открепить всё' });
    const confirmButton = unpinButtons[unpinButtons.length - 1];
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(setPinnedMessagesOpen).toHaveBeenCalledWith(false);
    });
  });

  it('should close image viewer when clicking backdrop', () => {
    const setOpenedImage = vi.fn();
    const pin = makePin({ message: makeMessage({ content: 'Фото' }) });

    renderView({
      pinnedMessages: [pin],
      openedImage: 'https://example.com/photo.jpg',
      setOpenedImage,
    });

    const viewer = screen.getByRole('dialog', { name: 'Просмотр изображения' });
    expect(viewer).toBeInTheDocument();

    fireEvent.click(viewer);
    expect(setOpenedImage).toHaveBeenCalledWith(null);
  });

  it('отображает текст и автора цитируемого сообщения из треда (#1084)', () => {
    const origin = makeMessage({
      id: 'origin-1',
      chatId: CHAT_ID,
      senderName: 'Алексей',
      content: 'Текст исходного сообщения',
    });
    const pinnedMsg = makeMessage({
      id: 'pin-msg-1',
      chatId: CHAT_ID,
      replyTo: 'origin-1',
      content: 'Ответ на сообщение',
    });
    const pin = makePin({
      id: 'pin-1',
      chatId: CHAT_ID,
      messageId: 'pin-msg-1',
      message: pinnedMsg,
    });

    renderView({
      pinnedMessages: [pin],
      threadMessages: [origin],
    });

    expect(screen.getByText('Ответ на сообщение')).toBeInTheDocument();
    expect(screen.getByText('Текст исходного сообщения')).toBeInTheDocument();
    expect(screen.getByText('Алексей')).toBeInTheDocument();
  });

  it('отображает текст цитаты из кеша треда QueryClient, если threadMessages не передан (#1084)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const origin = makeMessage({
      id: 'origin-2',
      chatId: CHAT_ID,
      senderName: 'Мария',
      content: 'Сообщение из кеша истории',
    });
    queryClient.setQueryData(chatKeys.messages(CHAT_ID), {
      pages: [[origin]],
      pageParams: [0],
    });

    const pinnedMsg = makeMessage({
      id: 'pin-msg-2',
      chatId: CHAT_ID,
      replyTo: 'origin-2',
      content: 'Закреплённый ответ',
    });
    const pin = makePin({
      id: 'pin-2',
      chatId: CHAT_ID,
      messageId: 'pin-msg-2',
      message: pinnedMsg,
    });

    renderView(
      {
        pinnedMessages: [pin],
      },
      queryClient
    );

    expect(screen.getByText('Закреплённый ответ')).toBeInTheDocument();
    expect(screen.getByText('Сообщение из кеша истории')).toBeInTheDocument();
    expect(screen.getByText('Мария')).toBeInTheDocument();
  });

  it.each([false, true])(
    'обновляет цитату без перемонтирования (кеш изначально заполнен: %s)',
    async (prefilled) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const origin = makeMessage({
        id: 'origin-live',
        chatId: CHAT_ID,
        senderName: 'Мария',
        content: 'Исходный текст цитаты',
      });
      const updateOrigin = (message = origin) =>
        queryClient.setQueryData(chatKeys.messages(CHAT_ID), {
          pages: [[message]],
          pageParams: [0],
        });
      if (prefilled) updateOrigin();

      renderView(
        {
          pinnedMessages: [
            makePin({
              chatId: CHAT_ID,
              message: makeMessage({ chatId: CHAT_ID, replyTo: origin.id, content: 'Ответ' }),
            }),
          ],
        },
        queryClient
      );

      if (!prefilled) {
        expect(screen.queryByText(origin.content)).not.toBeInTheDocument();
        await act(async () => {
          updateOrigin();
        });
      }
      await waitFor(() => expect(screen.getByText(origin.content)).toBeInTheDocument());
      expect(screen.getByText('Мария')).toBeInTheDocument();

      await act(async () => {
        updateOrigin({ ...origin, content: 'Изменённый текст цитаты' });
      });
      await waitFor(() => expect(screen.getByText('Изменённый текст цитаты')).toBeInTheDocument());
      expect(screen.queryByText(origin.content)).not.toBeInTheDocument();

      await act(async () => {
        queryClient.removeQueries({ queryKey: chatKeys.messages(CHAT_ID), exact: true });
      });
      await waitFor(() =>
        expect(screen.queryByText('Изменённый текст цитаты')).not.toBeInTheDocument()
      );
      expect(screen.getByText('Сообщение')).toBeInTheDocument();
    }
  );
});
