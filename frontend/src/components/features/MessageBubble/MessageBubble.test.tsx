import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { useChatUiStore } from '@/store';
import { describe, expect, it, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';

function renderBubble(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

describe('MessageBubble', () => {
  it('показывает превью сообщения, на которое отвечают', () => {
    const replied = makeMessage({ id: 'msg-1', content: 'исходное сообщение' });
    const reply = makeMessage({ id: 'msg-2', content: 'ответ', replyTo: 'msg-1' });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        repliedMessage={replied}
        translations={{}}
      />
    );

    expect(screen.getByText('исходное сообщение')).toBeInTheDocument();
    expect(screen.getByText('ответ')).toBeInTheDocument();
  });

  it('обходится без истории чата: ни кеша запросов, ни маршрутизатора', () => {
    /* Пузырь рисуется без `QueryClientProvider` и без роутера. Пока он
       искал цитату сам, ему требовались оба, а вместе с ними —
       подписка на всю ленту в каждом из сотен пузырей. */
    const message = makeMessage({ id: 'msg-1', content: 'просто сообщение' });

    expect(() =>
      renderBubble(
        <MessageBubble
          currentUserId="user-1"
          message={message}
          onOpenImage={vi.fn()}
          onReact={vi.fn()}
          onSelection={vi.fn()}
          translations={{}}
        />
      )
    ).not.toThrow();

    expect(screen.getByText('просто сообщение')).toBeInTheDocument();
  });

  it('показывает фоллбэк плашки ответа, когда исходное сообщение не найдено', () => {
    const reply = makeMessage({
      id: 'msg-2',
      content: 'ответ',
      replyTo: 'msg-0',
      replyToSenderName: 'Борис',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    expect(screen.getByText('Борис')).toBeInTheDocument();
    expect(screen.getByText('Сообщение')).toBeInTheDocument();
  });

  it('вызывает onJumpToMessage при клике и нажатии клавиш на плашке ответа (#553)', async () => {
    const user = userEvent.setup();
    const onJumpToMessage = vi.fn();
    const reply = makeMessage({
      id: 'msg-2',
      content: 'ответ',
      replyTo: 'msg-target-99',
      replyToContent: 'текст цитаты',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onJumpToMessage={onJumpToMessage}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const quoteButton = screen.getByRole('button', { name: /перейти к сообщению/i });
    expect(quoteButton).toHaveAttribute('tabindex', '0');

    // Клик мышью
    await user.click(quoteButton);
    expect(onJumpToMessage).toHaveBeenCalledWith('msg-target-99');

    // Клавиатура: Enter
    fireEvent.keyDown(quoteButton, { key: 'Enter' });
    expect(onJumpToMessage).toHaveBeenCalledTimes(2);

    // Клавиатура: Space
    fireEvent.keyDown(quoteButton, { key: ' ' });
    expect(onJumpToMessage).toHaveBeenCalledTimes(3);
  });

  it('применяет акцентный стиль при выделении сообщения', () => {
    const message = makeMessage({ id: 'msg-select-1', content: 'выбранное сообщение' });
    useChatUiStore.setState({
      selectedMessages: [message],
      selectionMode: true,
    });

    const { container } = renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const bubble = container.querySelector('.message-bubble');
    expect(bubble).toHaveAttribute('data-state', 'selected');
    expect(bubble).toHaveClass('is-selected');
  });

  it('показывает индикатор отправки со спиннером для исходящего сообщения со статусом uploading', () => {
    const message = makeMessage({
      id: 'msg-uploading-1',
      senderId: 'user-1',
      content: 'фотография',
      status: 'uploading',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const spinner = screen.getByRole('status');
    expect(spinner).toBeInTheDocument();
    expect(screen.getByText(/загрузка/i)).toBeInTheDocument();
  });

  it('отображает плашку ошибки и вызывает onRetryMessage по клику на кнопку повтора', async () => {
    const user = userEvent.setup();
    const onRetryMessage = vi.fn();
    const message = makeMessage({
      id: 'msg-failed-1',
      senderId: 'user-1',
      content: 'не ушло',
      status: 'failed',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onRetryMessage={onRetryMessage}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    expect(screen.getByText(/не удалось отправить/i)).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /повторить отправку/i });
    await user.click(retryButton);

    expect(onRetryMessage).toHaveBeenCalledWith(message);
  });

  it('вызывает onCancelMessage по клику на кнопку отмены/удаления', async () => {
    const user = userEvent.setup();
    const onCancelMessage = vi.fn();
    const message = makeMessage({
      id: 'msg-failed-2',
      senderId: 'user-1',
      content: 'удалить ошибку',
      status: 'failed',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onCancelMessage={onCancelMessage}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /удалить/i });
    await user.click(cancelButton);

    expect(onCancelMessage).toHaveBeenCalledWith(message);
  });
});
