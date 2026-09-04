import { useChatUiStore, useToastStore } from '@/store';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSelectedMessagesActions } from './ChatSelectedMessagesActions';

function renderActions(props: React.ComponentProps<typeof ChatSelectedMessagesActions>) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <ChatSelectedMessagesActions {...props} />
    </I18nextProvider>
  );
}

describe('ChatSelectedMessagesActions', () => {
  const defaultProps = {
    handleCancelSelection: vi.fn(),
    onForwardMessage: vi.fn(),
    onCopyMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useChatUiStore.setState({
      selectedMessages: [makeMessage({ id: 'msg-1' }), makeMessage({ id: 'msg-2' })],
    });
    useToastStore.setState({ toasts: [] });
  });

  it('отображает количество выбранных сообщений и кнопки действий', () => {
    renderActions(defaultProps);

    expect(screen.getByTestId('selected-count')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Переслать' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled();
  });

  it('отключает кнопки действий при пустом выборе', () => {
    useChatUiStore.setState({ selectedMessages: [] });
    renderActions(defaultProps);

    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Переслать' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeDisabled();
    // Кнопка Отмена всегда доступна
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled();
  });

  it('вызывает onForwardMessage и onCopyMessage при клике', async () => {
    const user = userEvent.setup();
    renderActions(defaultProps);

    await user.click(screen.getByRole('button', { name: 'Переслать' }));
    expect(defaultProps.onForwardMessage).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect(defaultProps.onCopyMessage).toHaveBeenCalledTimes(1);
  });

  it('открывает диалог подтверждения при нажатии Удалить и не удаляет при отмене', async () => {
    const user = userEvent.setup();
    const { container } = renderActions(defaultProps);

    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    // Появился модальный диалог подтверждения
    const dialog = container.querySelector('dialog');
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByText('Удалить выбранные сообщения?')).toBeInTheDocument();
    expect(screen.getByText(/2 шт\./i)).toBeInTheDocument();

    // Нажатие «Отмена» внутри модалки
    const cancelButtons = screen.getAllByRole('button', { name: 'Отмена' });
    // Кнопка отмены внутри модалки
    await user.click(cancelButtons[cancelButtons.length - 1]);

    expect(defaultProps.onDeleteMessage).not.toHaveBeenCalled();
    expect(dialog).not.toHaveAttribute('open');
  });

  it('удаляет сообщения при подтверждении в диалоге', async () => {
    const user = userEvent.setup();
    renderActions(defaultProps);

    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    // Нажатие «Удалить» внутри модалки подтверждения
    const deleteButtons = screen.getAllByRole('button', { name: 'Удалить' });
    const modalConfirmBtn = deleteButtons[deleteButtons.length - 1];

    await user.click(modalConfirmBtn);
    expect(defaultProps.onDeleteMessage).toHaveBeenCalledTimes(1);
  });

  it('сбрасывает выбор при нажатии Escape на клавиатуре', () => {
    renderActions(defaultProps);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.handleCancelSelection).toHaveBeenCalledTimes(1);
  });

  it('вызывает handleCancelSelection при клике на кнопку Отмена', async () => {
    const user = userEvent.setup();
    renderActions(defaultProps);

    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(defaultProps.handleCancelSelection).toHaveBeenCalledTimes(1);
  });

  it('показывает ошибку в тосте, если удаление сообщений завершилось сбоем', async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn().mockRejectedValue(new Error('Network error'));
    renderActions({ ...defaultProps, onDeleteMessage });

    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    const deleteButtons = screen.getAllByRole('button', { name: 'Удалить' });
    const modalConfirmBtn = deleteButtons[deleteButtons.length - 1];

    await user.click(modalConfirmBtn);

    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: 'Не удалось удалить сообщение(я)',
      })
    );
  });
});
