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
import { makeMessage } from '@/test/fixtures';

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
});
