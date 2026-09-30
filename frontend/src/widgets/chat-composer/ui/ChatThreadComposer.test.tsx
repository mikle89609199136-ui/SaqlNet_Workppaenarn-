import { testI18n } from '@/test/harness/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ChatThreadComposer } from './ChatThreadComposer';
import { clearOutbox } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services';
import { makeChat, makeMessage } from '@/test/fixtures';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { useForwardStore } from '@/features/forward-messages';
import { forgetEncryptionStates, setEncryptionState } from '@/shared/crypto';

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createRef } from 'react';
import type { IRichTextInputHandle } from '@/shared/ui';
import { typeIntoComposer } from '@/test/harness/composer';

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
    useForwardStore.getState().cancel();
    useProfileStore.setState({
      user: { id: 'user-me', username: 'tester' } as any,
    });
    useChatUiStore.setState({ error: '', editingMessage: null });
    setEncryptionState('chat-test-1', { status: 'ready', unreachable: [] });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    forgetEncryptionStates();
  });

  function setupProps(overrides = {}) {
    const attachmentInput = document.createElement('input');
    const bottomDiv = document.createElement('div');

    return {
      selectionMode: false,
      pendingAttachments: [],
      setPendingAttachments: vi.fn(),
      bottomRef: { current: bottomDiv },
      attachmentInputRef: { current: attachmentInput },
      draftRef: createRef<IRichTextInputHandle>(),
      setPhotoEditorFile: vi.fn(),
      setOpenedImage: vi.fn(),
      ...overrides,
    };
  }

  // Пустое поле — вместо «Отправить» микрофон (#843), как в макете.
  it('рендерит поле ввода и, пока отправлять нечего, микрофон', async () => {
    const props = setupProps();
    renderComposer(<ChatThreadComposer {...props} />, queryClient);

    expect(screen.getByRole('textbox', { name: /сообщение/i })).toBeInTheDocument();
    // Микрофон — когда шифрование готово: голосовое открытым не уйдёт.
    expect(await screen.findByRole('button', { name: 'Записать голосовое' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /отправить сообщение/i })).not.toBeInTheDocument();
  });

  it('активирует кнопку отправки при вводе текста и отправляет сообщение по клику', async () => {
    const props = setupProps();
    const serverMessage = makeMessage({ id: 'srv-1', chatId: 'chat-test-1', content: 'Привет' });
    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    renderComposer(<ChatThreadComposer {...props} />, queryClient);

    const input = screen.getByRole('textbox', { name: /сообщение/i });

    // Вводим текст — микрофон уступает место «Отправить».
    await typeIntoComposer(input, 'Привет');
    expect(input.textContent).toBe('Привет');
    expect(screen.queryByRole('button', { name: 'Записать голосовое' })).not.toBeInTheDocument();
    const sendButton = screen.getByRole('button', { name: /отправить сообщение/i });
    // Есть что отправить — кнопка залита акцентом, как в макете.
    expect(sendButton).toHaveClass('bg-brand-fill');

    // Нажимаем Отправить (отправляем форму)
    fireEvent.submit(sendButton.closest('form')!);

    // Поле мгновенно очищено
    expect(input.textContent).toBe('');
  });

  it('показывает все приложенные файлы, у каждого свой крестик (#171)', () => {
    const photo = new File(['dummy'], 'photo.png', { type: 'image/png' });
    const doc = new File(['dummy'], 'report.pdf', { type: 'application/pdf' });
    const props = setupProps({
      pendingAttachments: [
        { id: 'a1', file: photo, type: 'image' },
        { id: 'a2', file: doc, type: 'file' },
      ],
    });

    renderComposer(<ChatThreadComposer {...props} />, queryClient);

    // Фото — плиткой с превью, имя файла — в подписи для диктора.
    expect(
      screen.getByRole('button', { name: /Открыть изображение: photo.png/ })
    ).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить вложение: photo.png' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Удалить вложение: report.pdf' })
    ).toBeInTheDocument();
    // Карандаш — только у фото.
    expect(
      screen.getByRole('button', { name: 'Редактировать фото: photo.png' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Редактировать фото: report.pdf/ })).toBeNull();
    // Поле выбора — на несколько файлов сразу.
    expect(screen.getByLabelText('Прикрепить файл', { selector: 'input' })).toHaveAttribute(
      'multiple'
    );
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
      expect(screen.getByRole('button', { name: /отправить сообщение/i })).toHaveClass(
        'bg-brand-fill'
      );
    });

    it('крестик отменяет пересылку', async () => {
      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);

      await userEvent.click(screen.getByRole('button', { name: 'Отменить пересылку' }));

      expect(screen.queryByText('Переслать сообщение')).not.toBeInTheDocument();
      expect(useForwardStore.getState().pending).toBeNull();
    });

    it('«Отправить» уносит комментарий и пересланное одной пачкой', async () => {
      const order: string[] = [];
      const send = vi.spyOn(services.messageService, 'sendMessage');
      const forward = vi
        .spyOn(services.messageService, 'forwardMessages')
        .mockImplementation(async (chatId, originals, comment = '') => {
          if (comment) order.push(`комментарий: ${comment}`);
          originals.forEach((message) => order.push(`пересылка: ${message.content}`));
          return [comment, ...originals.map((message) => message.content)]
            .filter(Boolean)
            .map((content) => makeMessage({ chatId, content }));
        });

      renderComposer(<ChatThreadComposer {...setupProps()} />, queryClient);
      const input = screen.getByRole('textbox', { name: /сообщение/i });
      await typeIntoComposer(input, 'посмотри');
      fireEvent.submit(input.closest('form')!);

      await vi.waitFor(() => expect(useForwardStore.getState().pending).toBeNull());
      expect(order).toEqual(['комментарий: посмотри', 'пересылка: релиз в пятницу']);
      // Комментарий не уходит отдельной отправкой: он в той же пачке (#808).
      expect(forward).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(input.textContent).toBe('');
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

      expect(screen.getByRole('status')).toHaveTextContent('Вы заблокировали этого человека.');
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

  describe('вставка картинок из буфера обмена (#891)', () => {
    it('вставка картинки в поле добавляет её во вложения', () => {
      const setPendingAttachments = vi.fn();
      const props = setupProps({ setPendingAttachments });

      renderComposer(<ChatThreadComposer {...props} />, queryClient);

      const input = screen.getByRole('textbox', { name: /сообщение/i });
      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [file],
          types: ['Files'],
          getData: () => '',
        },
      });

      input.dispatchEvent(pasteEvent);

      expect(setPendingAttachments).toHaveBeenCalled();
      expect(pasteEvent.defaultPrevented).toBe(true);
    });

    it('смешанная вставка с текстом не добавляет вложения (приоритет текста)', () => {
      const setPendingAttachments = vi.fn();
      const props = setupProps({ setPendingAttachments });

      renderComposer(<ChatThreadComposer {...props} />, queryClient);

      const input = screen.getByRole('textbox', { name: /сообщение/i });
      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [file],
          types: ['text/plain', 'Files'],
          getData: (format: string) => (format === 'text/plain' ? 'Текст из статьи' : ''),
        },
      });

      input.dispatchEvent(pasteEvent);

      expect(setPendingAttachments).not.toHaveBeenCalled();
    });

    it('при редактировании сообщения вставка картинки не прикладывает файл', () => {
      const setPendingAttachments = vi.fn();
      const props = setupProps({ setPendingAttachments });

      useChatUiStore
        .getState()
        .setEditingMessage(makeMessage({ id: 'msg-edit', content: 'Текст' }));

      renderComposer(<ChatThreadComposer {...props} />, queryClient);

      const input = screen.getByRole('textbox', { name: /сообщение/i });
      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [file],
          types: ['Files'],
          getData: () => '',
        },
      });

      input.dispatchEvent(pasteEvent);

      expect(setPendingAttachments).not.toHaveBeenCalled();
    });

    it('вставка более 10 картинок прикладывает допустимое число и выводит ошибку лимита', () => {
      const setPendingAttachments = vi.fn();
      const props = setupProps({ setPendingAttachments });

      renderComposer(<ChatThreadComposer {...props} />, queryClient);

      const input = screen.getByRole('textbox', { name: /сообщение/i });
      const files = Array.from(
        { length: 11 },
        (_, i) => new File([`c${i}`], `shot-${i}.png`, { type: 'image/png' })
      );

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files,
          types: ['Files'],
          getData: () => '',
        },
      });

      input.dispatchEvent(pasteEvent);

      expect(setPendingAttachments).toHaveBeenCalled();
      expect(useChatUiStore.getState().error).toBe('Можно приложить не больше 10 файлов');
    });
  });
});
