import { useProfileStore } from '@/store';
import { makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagesList } from './MessagesList';

describe('MessagesList', () => {
  const currentUser = makeUser({ id: 'u-1', username: 'tester' });

  beforeEach(() => {
    useProfileStore.setState({ user: currentUser, isAuth: true, token: 'token' });
  });

  const renderComponent = (props: Partial<Parameters<typeof MessagesList>[0]> = {}) => {
    const defaultProps = {
      messages: [],
      isLoading: false,
      error: '',
      setOpenedImage: vi.fn(),
      toggleMessageSelection: vi.fn(),
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
});
