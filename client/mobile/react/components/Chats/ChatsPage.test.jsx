import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatsPage } from './ChatsPage.jsx';
import { services } from '../../../application/services/serviceContainer.js';
import { eventBus } from '../../../core/EventBus.js';

vi.mock('../../../application/services/serviceContainer.js', () => ({
  services: {
    chatService: {
      getChats: vi.fn(),
    },
    messageService: {
      processMessageForDisplay: vi.fn(),
    },
  },
}));

vi.mock('../../hooks/useRealtimeSocket.js', () => ({
  useRealtimeSocket: () => ({ eventBus, socket: null }),
}));

describe('ChatsPage', () => {
  beforeEach(() => {
    eventBus.clear();
    localStorage.setItem('craneapp_user_data', JSON.stringify({ firstName: 'Ivan', username: 'ivan_1' }));
    services.chatService.getChats.mockReset();
    services.messageService.processMessageForDisplay.mockReset();
  });

  it('renders chats from the application chat service', async () => {
    services.chatService.getChats.mockResolvedValue([
      {
        id: 'chat-1',
        name: 'Team',
        type: 'group',
        lastMessage: 'Hello',
        unreadCount: 2,
        createdAt: new Date('2026-06-03T12:00:00Z'),
      },
    ]);

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /team/i })).toHaveAttribute('href', '/chats/chat-1');
  });

  it('renders an empty state', async () => {
    services.chatService.getChats.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/чатов пока нет/i)).toBeInTheDocument();
  });

  it('decrypts encrypted last message previews', async () => {
    services.chatService.getChats.mockResolvedValue([
      {
        id: 'chat-1',
        name: 'Paul',
        type: 'private',
        lastMessage: {
          id: 'm1',
          senderId: 'u2',
          content: '{"e2e":true,"iv":"iv","data":"data"}',
          type: 'text',
          createdAt: '2026-06-03T12:00:00Z',
        },
        unreadCount: 0,
        createdAt: new Date('2026-06-03T12:00:00Z'),
      },
    ]);
    services.messageService.processMessageForDisplay.mockResolvedValue({ content: 'Привет' });

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Привет')).toBeInTheDocument();
    expect(services.messageService.processMessageForDisplay).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      chatId: 'chat-1',
      content: '{"e2e":true,"iv":"iv","data":"data"}',
    }));
  });

  it('updates the last message preview from realtime events', async () => {
    services.chatService.getChats.mockResolvedValue([
      {
        id: 'chat-1',
        name: 'Paul',
        type: 'private',
        lastMessage: {
          id: 'm1',
          senderId: 'u2',
          content: 'old',
          type: 'text',
          createdAt: '2026-06-03T12:00:00Z',
        },
        unreadCount: 0,
        createdAt: new Date('2026-06-03T12:00:00Z'),
      },
    ]);
    services.messageService.processMessageForDisplay
      .mockResolvedValueOnce({ content: 'old' })
      .mockResolvedValueOnce({ content: 'Новое сообщение' });

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('old')).toBeInTheDocument();

    eventBus.emit('new_message', {
      chatId: 'chat-1',
      message: {
        id: 'm2',
        chatId: 'chat-1',
        senderId: 'u2',
        content: '{"e2e":true,"iv":"iv","data":"new"}',
        type: 'text',
        createdAt: '2026-06-03T12:01:00Z',
      },
    });

    expect(await screen.findByText('Новое сообщение')).toBeInTheDocument();
  });

  it('clears unread badge when messages are marked as read', async () => {
    services.chatService.getChats.mockResolvedValue([
      {
        id: 'chat-1',
        name: 'Paul',
        type: 'private',
        lastMessage: 'hi',
        unreadCount: 3,
        createdAt: new Date('2026-06-03T12:00:00Z'),
      },
    ]);

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('3')).toBeInTheDocument();

    eventBus.emit('messages:read', { chatId: 'chat-1', messageIds: ['m1'] });

    await waitFor(() => {
      expect(screen.queryByText('3')).not.toBeInTheDocument();
    });
  });

  it('renders a load error state', async () => {
    services.chatService.getChats.mockRejectedValue(new Error('Network failed'));

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Network failed')).toBeInTheDocument();
    });
  });
});
