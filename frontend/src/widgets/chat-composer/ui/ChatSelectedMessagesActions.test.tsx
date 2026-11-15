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

  // Отмеченное пересылается одной пачкой (#1061): одно непересылаемое
  // сорвало бы её целиком, поэтому кнопки нет.
  it.each([
    ['звонок', makeMessage({ id: 'call-1', type: 'call', content: '{}' })],
    [
      'вложение, которое не открылось',
      makeMessage({
        id: 'photo-1',
        type: 'image',
        mediaUrl: null,
        mediaUnavailable: true,
      } as never),
    ],
  ])('нет «Переслать», если среди отмеченных %s', (_name, blocked) => {
    useChatUiStore.setState({ selectedMessages: [makeMessage({ id: 'msg-1' }), blocked] });
    renderActions(defaultProps);

    expect(screen.queryByRole('button', { name: 'Переслать' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeEnabled();
  });

  it('«Переслать» есть, когда отмечены текст и фото', () => {
    useChatUiStore.setState({
      selectedMessages: [
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'photo-1', type: 'image', content: '', mediaUrl: 'blob:p' } as never),
      ],
    });
    renderActions(defaultProps);

    expect(screen.getByRole('button', { name: 'Переслать' })).toBeEnabled();
  });

  it('отображает кнопку «Перевести», если есть переводимые сообщения и передан onTranslateMessage', async () => {
    const user = userEvent.setup();
    const onTranslateMessage = vi.fn();
    useChatUiStore.setState({
      selectedMessages: [makeMessage({ id: 'msg-1', content: 'Привет' })],
    });
    renderActions({ ...defaultProps, onTranslateMessage });

    const translateBtn = screen.getByRole('button', { name: 'Перевести' });
    expect(translateBtn).toBeInTheDocument();
    expect(translateBtn).toBeEnabled();

    await user.click(translateBtn);
    expect(onTranslateMessage).toHaveBeenCalledTimes(1);
  });

  it('не отображает кнопку «Перевести», если нет переводимых сообщений', () => {
    const onTranslateMessage = vi.fn();
    useChatUiStore.setState({
      selectedMessages: [makeMessage({ id: 'call-1', type: 'call', content: '{}' })],
    });
    renderActions({ ...defaultProps, onTranslateMessage });

    expect(screen.queryByRole('button', { name: 'Перевести' })).not.toBeInTheDocument();
  });

  it('не отображает кнопку «Перевести», если onTranslateMessage не передан', () => {
    useChatUiStore.setState({
      selectedMessages: [makeMessage({ id: 'msg-1', content: 'Привет' })],
    });
    renderActions(defaultProps);

    expect(screen.queryByRole('button', { name: 'Перевести' })).not.toBeInTheDocument();
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
