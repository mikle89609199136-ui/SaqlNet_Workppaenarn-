import { useChatUiStore } from '@/entities/chat';
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
      deleteTargets: null,
    });
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

  // Подтверждение — общий диалог чата (#840): панель только открывает его.
  it('«Удалить» открывает подтверждение, а не удаляет сразу', async () => {
    const user = userEvent.setup();
    renderActions(defaultProps);

    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(defaultProps.onDeleteMessage).toHaveBeenCalledTimes(1);
  });

  it('Escape не сбрасывает выбор, пока открыто подтверждение', () => {
    useChatUiStore.setState({ deleteTargets: [makeMessage({ id: 'msg-1' })] });
    renderActions(defaultProps);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.handleCancelSelection).not.toHaveBeenCalled();
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
});
