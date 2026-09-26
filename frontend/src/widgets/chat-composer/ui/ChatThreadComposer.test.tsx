import { testI18n } from '@/test/harness/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatThreadComposer } from './ChatThreadComposer';
import { clearOutbox } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services';
import { makeChat, makeMessage } from '@/test/fixtures';
import { chatKeys } from '@/entities/chat';
import { useForwardStore } from '@/features/forward-messages';

import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/features/chat-encryption', () => ({
  useEncryptionState: () => ({ status: 'ready', unreachable: [] }),
  useChatEncryption: () => vi.fn(),
}));

vi.mock('@/features/typing-indicator', () => ({
  useTypingIndicator: () => vi.fn(),
}));

function renderComposer(ui: React.ReactElement, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={['/chats/chat-test-1']}>
          <Routes>
            <Route path="/chats/:chatId" element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('ChatThreadComposer', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clearOutbox();
    useProfileStore.setState({
      user: { id: 'user-me', username: 'tester' } as any,
    });
    vi.restoreAllMocks();
  });

  function setupProps(overrides = {}) {
    const draftInput = document.createElement('input');
    const attachmentInput = document.createElement('input');
    const bottomDiv = document.createElement('div');

    return {
      selectionMode: false,
      pendingAttachment: null,
      setPendingAttachment: vi.fn(),
      bottomRef: { current: bottomDiv },
      attachmentInputRef: { current: attachmentInput },
      draftRef: { current: draftInput },
      setPhotoEditorFile: vi.fn(),
      setOpenedImage: vi.fn(),
      ...overrides,
    };
  }

  it('рендерит поле ввода и кнопку отправки', () => {
    const props = setupProps();
    renderComposer(<ChatThreadComposer {...props} />, queryClient);

    expect(screen.getByRole('textbox', { name: /сообщение/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /отправить сообщение/i })).toBeInTheDocument();
  });

  it('активирует кнопку отправки при вводе текста и отправляет сообщение по клику', async () => {
    const props = setupProps();
    const serverMessage = makeMessage({ id: 'srv-1', chatId: 'chat-test-1', content: 'Привет' });
    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    renderComposer(<ChatThreadComposer {...props} />, queryClient);

    const input = screen.getByRole('textbox', { name: /сообщение/i });
    const sendButton = screen.getByRole('button', { name: /отправить сообщение/i });

    // Вводим текст
    fireEvent.change(input, { target: { value: 'Привет' } });
    expect(input).toHaveValue('Привет');
    expect(sendButton).toHaveClass('is-active');

    // Нажимаем Отправить (отправляем форму)
    fireEvent.submit(sendButton.closest('form')!);

    // Поле мгновенно очищено
    expect(input).toHaveValue('');
  });

  it('отображает блок превью вложения, если pendingAttachment передан', () => {
    const file = new File(['dummy'], 'photo.png', { type: 'image/png' });
    const props = setupProps({
      pendingAttachment: {
        file,
        type: 'image',
      },
    });

    renderComposer(<ChatThreadComposer {...props} />, queryClient);

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /удалить вложение/i })).toBeInTheDocument();
  });

  describe('пересылка ждёт над полем ввода (#93)', () => {
    const original = makeMessage({ id: 'orig-1', content: 'релиз в пятницу', senderName: 'Анна' });

    beforeEach(() => {
      useForwardStore.getState().start('chat-test-1', [original]);
    });

    it('показывает, что будет переслано, и даёт отправить без текста', () => {
      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);

      expect(screen.getByText('Переслать сообщение')).toBeInTheDocument();
      expect(screen.getByText(/релиз в пятницу/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /отправить сообщение/i })).toHaveClass('is-active');
    });

    it('крестик отменяет пересылку', async () => {
      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);

      await userEvent.click(screen.getByRole('button', { name: 'Отменить пересылку' }));

      expect(screen.queryByText('Переслать сообщение')).not.toBeInTheDocument();
      expect(useForwardStore.getState().pending).toBeNull();
    });

    it('«Отправить» уносит комментарий, а затем пересланное', async () => {
      const order: string[] = [];
      vi.spyOn(services.messageService, 'sendMessage').mockImplementation(
        async (chatId, content) => {
          order.push(`комментарий: ${content}`);
          return makeMessage({ chatId, content });
        }
      );
      vi.spyOn(services.messageService, 'forwardMessage').mockImplementation(
        async (message, chatId) => {
          order.push(`пересылка: ${message.content}`);
          return makeMessage({ chatId, content: message.content });
        }
      );

      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);
      const input = screen.getByRole('textbox', { name: /сообщение/i });
      fireEvent.change(input, { target: { value: 'посмотри' } });
      fireEvent.submit(input.closest('form')!);

      await vi.waitFor(() => expect(useForwardStore.getState().pending).toBeNull());
      expect(order).toEqual(['комментарий: посмотри', 'пересылка: релиз в пятницу']);
      expect(input).toHaveValue('');
    });
  });

  describe('блокировка в личном чате (#760)', () => {
    function seedChat(extra: object) {
      queryClient.setQueryData(
        chatKeys.detail('chat-test-1'),
        makeChat({ id: 'chat-test-1', type: 'private', peerId: 'user-peer', ...extra })
      );
    }

    it('вас заблокировали — вместо поля ввода объяснение, писать нечем', () => {
      seedChat({ isBlockedByPeer: true });

      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);

      expect(screen.getByRole('status')).toHaveTextContent(
        'Этот человек ограничил переписку с вами'
      );
      expect(screen.queryByRole('textbox', { name: /сообщение/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /отправить сообщение/i })
      ).not.toBeInTheDocument();
    });

    it('вы заблокировали — «Разблокировать» снимает блокировку и перечитывает чат', async () => {
      seedChat({ isPeerBlocked: true });
      const unblock = vi
        .spyOn(services.userService, 'unblockUser')
        .mockResolvedValue({ success: true });
      // Чат с этим человеком перечитывается — с сервера он придёт уже без флага.
      const refetch = vi
        .spyOn(services.chatService, 'getChat')
        .mockResolvedValue(
          makeChat({ id: 'chat-test-1', type: 'private', peerId: 'user-peer' }) as never
        );

      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);

      expect(screen.getByRole('status')).toHaveTextContent('Вы заблокировали этого пользователя');
      await userEvent.click(screen.getByRole('button', { name: 'Разблокировать' }));

      expect(unblock).toHaveBeenCalledWith('user-peer');
      await vi.waitFor(() => expect(refetch).toHaveBeenCalledWith('chat-test-1'));
      // Флага больше нет — вернулось обычное поле ввода.
      expect(await screen.findByRole('textbox', { name: /сообщение/i })).toBeInTheDocument();
    });

    it('без блокировки — обычное поле ввода', () => {
      seedChat({});

      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);

      expect(screen.getByRole('textbox', { name: /сообщение/i })).toBeInTheDocument();
    });
  });
});
