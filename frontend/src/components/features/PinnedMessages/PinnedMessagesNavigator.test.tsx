import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMessage, makePin } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { useChatUiStore } from '@/store';
import { PinnedMessagesNavigator } from './PinnedMessagesNavigator';

function renderNavigator(props: React.ComponentProps<typeof PinnedMessagesNavigator>) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <PinnedMessagesNavigator {...props} />
    </I18nextProvider>
  );
}

describe('PinnedMessagesNavigator', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
  });

  it('should not render anything when messages list is empty', () => {
    const setPinnedMessagesOpen = vi.fn();
    const { container } = renderNavigator({
      messages: [],
      setPinnedMessagesOpen,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('should render text message content', () => {
    const pin = makePin({ message: makeMessage({ content: 'Важное объявление', type: 'text' }) });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText('Важное объявление')).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();
  });

  it('should display author name when available', () => {
    const pin = makePin({
      message: makeMessage({
        senderFirstName: 'Алексей',
        content: 'Текст',
      }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText(/Алексей/)).toBeInTheDocument();
  });

  it('should set highlighted message id in chatUi store on click', () => {
    const pin = makePin({
      message: makeMessage({ id: 'target-msg-123', content: 'Целевое' }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });

    const navButton = screen.getByRole('button', { name: 'Закреплённые сообщения' });
    fireEvent.click(navButton);

    expect(useChatUiStore.getState().highlightedMessageId).toBe('target-msg-123');
  });

  it('should render localized snippet for video message without text', () => {
    const pin = makePin({
      message: makeMessage({ content: '', type: 'video' }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText('Видео')).toBeInTheDocument();
  });

  it('should render localized snippet for audio message without text', () => {
    const pin = makePin({
      message: makeMessage({ content: '', type: 'audio' }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText('Аудиозапись')).toBeInTheDocument();
  });

  it('should render localized snippet for voice message without text', () => {
    const pin = makePin({
      message: makeMessage({ content: '', type: 'voice' }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText('Голосовое сообщение')).toBeInTheDocument();
  });

  it('should render localized snippet for photo instead of raw mediaUrl', () => {
    const pin = makePin({
      message: makeMessage({ content: '', type: 'image', mediaUrl: 'blob:http://localhost/123' }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText('Фотография')).toBeInTheDocument();
    expect(screen.queryByText('blob:http://localhost/123')).toBeNull();
  });

  it('should safely render file message when mediaEncryption is undefined', () => {
    const message = makeMessage({ content: '', type: 'file' });
    delete (message as any).mediaEncryption;
    const pin = makePin({ message });

    expect(() => {
      renderNavigator({
        messages: [pin],
        setPinnedMessagesOpen: vi.fn(),
      });
    }).not.toThrow();

    expect(screen.getByText('Файл')).toBeInTheDocument();
  });

  it('should render call message snippet', () => {
    const pin = makePin({
      message: makeMessage({ content: '', type: 'call' }),
    });
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen: vi.fn(),
    });
    expect(screen.getByText('Звонок')).toBeInTheDocument();
  });

  it('should open all pinned messages modal when pin button is clicked', () => {
    const setPinnedMessagesOpen = vi.fn();
    const pin = makePin();
    renderNavigator({
      messages: [pin],
      setPinnedMessagesOpen,
    });

    const pinButton = screen.getByRole('button', { name: 'Показать все закреплённые сообщения' });
    fireEvent.click(pinButton);
    expect(setPinnedMessagesOpen).toHaveBeenCalledWith(true);
  });

  it('should cycle through messages when clicking navigator button', () => {
    const pin1 = makePin({ message: makeMessage({ id: 'msg-1', content: 'Первое' }) });
    const pin2 = makePin({ message: makeMessage({ id: 'msg-2', content: 'Второе' }) });

    renderNavigator({
      messages: [pin1, pin2],
      setPinnedMessagesOpen: vi.fn(),
    });

    // Initial item is the last one (#2)
    expect(screen.getByText('Второе')).toBeInTheDocument();
    expect(screen.getByText(/#2/)).toBeInTheDocument();

    // Click cycles to #1
    const navButton = screen.getByRole('button', { name: 'Закреплённые сообщения' });
    fireEvent.click(navButton);
    expect(screen.getByText('Первое')).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();

    // Click cycles back to #2
    fireEvent.click(navButton);
    expect(screen.getByText('Второе')).toBeInTheDocument();
    expect(screen.getByText(/#2/)).toBeInTheDocument();
  });
});
