import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatsPage } from './ChatsPage.jsx';
import { services } from '../../../application/services/serviceContainer.js';

vi.mock('../../../application/services/serviceContainer.js', () => ({
  services: {
    chatService: {
      getChats: vi.fn(),
    },
  },
}));

describe('ChatsPage', () => {
  beforeEach(() => {
    localStorage.setItem('craneapp_user_data', JSON.stringify({ firstName: 'Ivan', username: 'ivan_1' }));
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
