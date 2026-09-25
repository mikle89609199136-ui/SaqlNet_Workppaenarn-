import { testI18n } from '@/test/harness/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatThreadHeader } from './ChatThreadHeader';
import { useCallStore } from '@/features/call';
import { chatKeys } from '@/entities/chat';
import { userKeys } from '@/entities/user';
import { makeChat } from '@/test/fixtures';

const mockInitiateCall = vi.fn();

vi.mock('@/shared/lib', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib')>('@/shared/lib');
  return {
    ...actual,
    useConnectionStatus: () => 'connected',
  };
});

function renderHeader(client: QueryClient, chatId = 'chat-1') {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={[`/chats/${chatId}`]}>
          <Routes>
            <Route path="/chats/:chatId" element={<ChatThreadHeader />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('ChatThreadHeader', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockInitiateCall.mockReset();
    useCallStore.setState({ initiateCall: mockInitiateCall });
    vi.restoreAllMocks();
  });

  it('рендерит шапку личного чата с активными кнопками звонков для незаблокированного собеседника', () => {
    const chat = makeChat({
      id: 'chat-1',
      title: 'Анна',
      type: 'private',
      peerId: 'peer-1',
      peerIsOnline: true,
    });
    queryClient.setQueryData(chatKeys.detail('chat-1'), chat);
    queryClient.setQueryData(userKeys.blocked(), []);

    renderHeader(queryClient, 'chat-1');

    expect(screen.getByText('Анна')).toBeInTheDocument();

    const audioBtn = screen.getByTitle('Аудиозвонок');
    const videoBtn = screen.getByTitle('Видео');

    expect(audioBtn).not.toBeDisabled();
    expect(videoBtn).not.toBeDisabled();

    fireEvent.click(audioBtn);
    expect(mockInitiateCall).toHaveBeenCalledWith('chat-1', 'private', 'Анна', 'audio', 'peer-1');
  });

  it('подавляет presence, отображает статус "Заблокирован" и отключает кнопки звонков, если собеседник заблокирован', () => {
    const chat = makeChat({
      id: 'chat-1',
      title: 'Анна',
      type: 'private',
      peerId: 'peer-1',
      peerIsOnline: true,
    });
    queryClient.setQueryData(chatKeys.detail('chat-1'), chat);
    queryClient.setQueryData(userKeys.blocked(), [
      {
        id: 'peer-1',
        username: 'anna',
        firstName: 'Анна',
        lastName: '',
        avatarUrl: '',
        blockedAt: '2026-09-25T10:00:00Z',
      },
    ]);

    renderHeader(queryClient, 'chat-1');

    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('Заблокирован')).toBeInTheDocument();

    const blockedButtons = screen.getAllByTitle('Заблокирован');
    expect(blockedButtons.length).toBeGreaterThan(0);
    blockedButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });

    fireEvent.click(blockedButtons[0]);
    expect(mockInitiateCall).not.toHaveBeenCalled();
  });
});
