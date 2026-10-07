import { useChatUiStore } from '@/entities/chat';
import { formatMessageTime } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { formatCallDuration } from '@/shared/lib';
import { mockThreadLayout } from '@/test/harness/threadLayout';
import { makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagesList } from './MessagesList';

describe('MessagesList', () => {
  const currentUser = makeUser({ id: 'u-1', username: 'tester' });

  beforeEach(() => {
    useProfileStore.setState({ user: currentUser, isAuth: true });
  });

  const renderComponent = (props: Partial<Parameters<typeof MessagesList>[0]> = {}) => {
    const defaultProps = {
      messages: [],
      isLoading: false,
      error: '',
      setOpenedImage: vi.fn(),
      toggleMessageSelection: vi.fn(),
      onReact: vi.fn(),
      ...props,
    };

    return render(
      <I18nextProvider i18n={testI18n}>
        <MessagesList {...defaultProps} />
      </I18nextProvider>
    );
  };

  it('renders empty thread state when messages list is empty', () => {
    renderComponent({ messages: [] });
    expect(screen.getByText('Сообщений пока нет')).toBeInTheDocument();
  });

  it('renders error state when error is present and list is empty', () => {
    renderComponent({ messages: [], error: 'Ошибка сети' });
    expect(screen.getByText('Ошибка сети')).toBeInTheDocument();
  });

  it('renders message bubbles and date dividers', () => {
    const m1 = makeMessage({
      id: 'msg-1',
      content: 'Привет от вчера',
      createdAt: '2026-05-10T10:00:00Z',
    });
    const m2 = makeMessage({
      id: 'msg-2',
      content: 'Привет от сегодня',
      createdAt: '2026-05-11T12:00:00Z',
    });

    renderComponent({ messages: [m1, m2] });

    expect(screen.getByText('Привет от вчера')).toBeInTheDocument();
    expect(screen.getByText('Привет от сегодня')).toBeInTheDocument();
  });

  describe('лента с клавиатуры (#910)', () => {
    const messages = Array.from({ length: 5 }, (_, index) =>
      makeMessage({
        id: `msg-${index + 1}`,
        senderId: 'u-2',
        content: `сообщение ${index + 1}`,
        createdAt: `2026-05-11T12:0${index}:00Z`,
      })
    );

    const article = (id: string) => document.getElementById(id)!;
    const tabStops = () =>
      screen.getAllByRole('article').filter((element) => element.tabIndex === 0);

    beforeEach(() => {
      mockThreadLayout({ viewport: 20_000 });
      useChatUiStore.setState({ actionMenu: null, selectionMode: false, selectedMessages: [] });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('лента — одна остановка Tab, на последнем сообщении', () => {
      renderComponent({ messages, trackUnread: false });

      expect(tabStops()).toEqual([article('msg-5')]);
    });

    it('стрелки переходят между сообщениями, Home и End — к первому и последнему', () => {
      renderComponent({ messages, trackUnread: false });
      article('msg-5').focus();

      fireEvent.keyDown(article('msg-5'), { key: 'ArrowUp' });
      expect(article('msg-4')).toHaveFocus();
      expect(tabStops()).toEqual([article('msg-4')]);

      fireEvent.keyDown(article('msg-4'), { key: 'ArrowDown' });
      expect(article('msg-5')).toHaveFocus();

      fireEvent.keyDown(article('msg-5'), { key: 'Home' });
      expect(article('msg-1')).toHaveFocus();

      fireEvent.keyDown(article('msg-1'), { key: 'ArrowUp' });
      expect(article('msg-1')).toHaveFocus();

      fireEvent.keyDown(article('msg-1'), { key: 'End' });
      expect(article('msg-5')).toHaveFocus();
    });

    it.each([
      ['Enter', { key: 'Enter' }],
      ['клавиша меню', { key: 'ContextMenu' }],
      ['Shift+F10', { key: 'F10', shiftKey: true }],
    ])('%s на сообщении открывает его меню', (_, keys) => {
      renderComponent({ messages, trackUnread: false });
      article('msg-3').focus();

      fireEvent.keyDown(article('msg-3'), keys);

      expect(useChatUiStore.getState().actionMenu?.messageId).toBe('msg-3');
    });

    it('в режиме выбора Enter отмечает сообщение, а не открывает меню', () => {
      useChatUiStore.setState({ selectionMode: true });
      const toggleMessageSelection = vi.fn();
      renderComponent({ messages, trackUnread: false, toggleMessageSelection });

      fireEvent.keyDown(article('msg-2'), { key: 'Enter' });

      expect(toggleMessageSelection).toHaveBeenCalledWith(messages[1]);
      expect(useChatUiStore.getState().actionMenu).toBeNull();
    });

    it('диктор слышит автора, текст и время сообщения', () => {
      renderComponent({ messages, trackUnread: false });

      expect(article('msg-1')).toHaveAccessibleName(
        `Тестовый, сообщение 1, ${formatMessageTime(messages[0].createdAt)}`
      );
    });

    it('у звонка диктор слышит подпись звонка, а не его данные', () => {
      const call = makeMessage({
        id: 'call-1',
        senderId: 'u-2',
        type: 'call',
        content: JSON.stringify({ callKind: 'video', duration: 28, initiatorId: 'u-2' }),
        createdAt: '2026-05-11T12:09:00Z',
      });
      renderComponent({ messages: [call], trackUnread: false });

      expect(article('call-1')).toHaveAccessibleName(
        `Тестовый, Звонок завершен, ${formatCallDuration(28)}, ${formatMessageTime(call.createdAt)}`
      );
    });

    it('кнопка «⋯» открывает то же меню, на телефоне её нет', () => {
      renderComponent({ messages, trackUnread: false });
      const more = screen.getAllByRole('button', { name: 'Действия с сообщением' })[1];

      fireEvent.click(more);

      expect(useChatUiStore.getState().actionMenu?.messageId).toBe('msg-2');
      expect(more).toHaveClass('max-md:hidden');
    });
  });
});
