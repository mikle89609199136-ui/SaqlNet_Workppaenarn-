import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeMessage, makePin, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { chatKeys } from '@/queries/keys';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from '@/store/profile';
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
    expect(screen.getByText('Закрепления пропадут у всех участников чата.')).toBeInTheDocument();

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
});
