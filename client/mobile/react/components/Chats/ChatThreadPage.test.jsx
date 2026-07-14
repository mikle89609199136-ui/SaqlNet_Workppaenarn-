import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatThreadPage } from './ChatThreadPage.jsx';
import { services } from '../../../application/services/serviceContainer.js';
import { eventBus } from '../../../core/EventBus.js';

vi.mock('../../../application/services/serviceContainer.js', () => ({
  services: {
    chatService: {
      getChat: vi.fn(),
    },
    messageService: {
      addMessageToCache: vi.fn(),
      deleteMessage: vi.fn(),
      editMessage: vi.fn(),
      getMessages: vi.fn(),
      reactToMessage: vi.fn(),
      sendMessage: vi.fn(),
    },
  },
}));

vi.mock('../../hooks/useRealtimeSocket.js', () => ({
  useRealtimeSocket: () => ({ eventBus, socket: null }),
}));

vi.mock('../Calls/CallProvider.jsx', () => ({
  useCall: () => ({
    initiateCall: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

describe('ChatThreadPage', () => {
  beforeEach(() => {
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'u1', firstName: 'Ivan' }));
  });

  it('renders chat messages', async () => {
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([
      { id: 'm1', senderId: 'u2', senderFirstName: 'Anna', content: 'Hello', timestamp: new Date('2026-06-03T12:00:00Z') },
      { id: 'm2', senderId: 'u1', content: 'Hi', timestamp: new Date('2026-06-03T12:01:00Z') },
    ]);

    render(<ChatThreadPage chatId="chat-1" />);

    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('sends a text message through the message service', async () => {
    const user = userEvent.setup();
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([]);
    services.messageService.sendMessage.mockResolvedValue({
      id: 'm3',
      senderId: 'u1',
      content: 'New message',
      timestamp: new Date('2026-06-03T12:02:00Z'),
    });

    render(<ChatThreadPage chatId="chat-1" />);

    await screen.findByRole('heading', { name: 'Team' });
    await user.type(screen.getByRole('textbox', { name: /сообщение/i }), 'New message');
    await user.click(screen.getByRole('button', { name: '➤' }));

    await waitFor(() => {
      expect(services.messageService.sendMessage).toHaveBeenCalledWith('chat-1', 'New message', 'text', null);
    });
    expect(await screen.findByText('New message')).toBeInTheDocument();
  });

  it('does not duplicate a sent message echoed by realtime', async () => {
    const user = userEvent.setup();
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([]);
    services.messageService.sendMessage.mockResolvedValue({
      id: 'm3',
      chatId: 'chat-1',
      senderId: 'u1',
      content: 'New message',
      timestamp: new Date('2026-06-03T12:02:00Z'),
    });

    render(<ChatThreadPage chatId="chat-1" />);

    await screen.findByRole('heading', { name: 'Team' });
    await user.type(screen.getByRole('textbox', { name: /сообщение/i }), 'New message');
    await user.click(screen.getByRole('button', { name: '➤' }));
    await screen.findByText('New message');

    eventBus.emit('new_message', {
      chatId: 'chat-1',
      message: {
        id: 'm3',
        chatId: 'chat-1',
        senderId: 'u1',
        content: 'New message',
        createdAt: '2026-06-03T12:02:00Z',
      },
    });

    await waitFor(() => {
      expect(screen.getAllByText('New message')).toHaveLength(1);
    });
  });

  it('sends a reply with the selected message id', async () => {
    const user = userEvent.setup();
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([
      { id: 'm1', senderId: 'u2', senderFirstName: 'Anna', content: 'Original', timestamp: new Date('2026-06-03T12:00:00Z') },
    ]);
    services.messageService.sendMessage.mockResolvedValue({
      id: 'm2',
      senderId: 'u1',
      content: 'Reply',
      timestamp: new Date('2026-06-03T12:02:00Z'),
    });

    render(<ChatThreadPage chatId="chat-1" />);

    await screen.findByText('Original');
    await user.click(screen.getByRole('button', { name: /ответ/i }));
    await user.type(screen.getByRole('textbox', { name: /сообщение/i }), 'Reply');
    await user.click(screen.getByRole('button', { name: '➤' }));

    await waitFor(() => {
      expect(services.messageService.sendMessage).toHaveBeenCalledWith('chat-1', 'Reply', 'text', 'm1');
    });
  });

  it('edits own messages', async () => {
    const user = userEvent.setup();
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([
      { id: 'm1', senderId: 'u1', content: 'Old text', timestamp: new Date('2026-06-03T12:00:00Z') },
    ]);
    services.messageService.editMessage.mockResolvedValue({
      messageId: 'm1',
      content: 'Updated text',
      editedAt: new Date('2026-06-03T12:05:00Z'),
    });

    render(<ChatThreadPage chatId="chat-1" />);

    await screen.findByText('Old text');
    await user.click(screen.getByRole('button', { name: /изм/i }));
    await user.clear(screen.getByRole('textbox', { name: /сообщение/i }));
    await user.type(screen.getByRole('textbox', { name: /сообщение/i }), 'Updated text');
    await user.click(screen.getByRole('button', { name: '➤' }));

    expect(await screen.findByText('Updated text')).toBeInTheDocument();
    expect(services.messageService.editMessage).toHaveBeenCalledWith('m1', 'Updated text');
  });

  it('deletes own messages', async () => {
    const user = userEvent.setup();
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([
      { id: 'm1', senderId: 'u1', content: 'Delete me', timestamp: new Date('2026-06-03T12:00:00Z') },
    ]);
    services.messageService.deleteMessage.mockResolvedValue({ success: true });

    render(<ChatThreadPage chatId="chat-1" />);

    await screen.findByText('Delete me');
    await user.click(screen.getByRole('button', { name: /удалить/i }));

    await waitFor(() => {
      expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    });
    expect(services.messageService.deleteMessage).toHaveBeenCalledWith('m1');
  });

  it('updates reactions through the message service', async () => {
    const user = userEvent.setup();
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([
      { id: 'm1', senderId: 'u2', senderFirstName: 'Anna', content: 'React here', timestamp: new Date('2026-06-03T12:00:00Z') },
    ]);
    services.messageService.reactToMessage.mockResolvedValue({
      reactions: [{ emoji: '👍', count: 1, myReaction: true }],
    });

    render(<ChatThreadPage chatId="chat-1" />);

    await screen.findByText('React here');
    await user.click(screen.getByRole('button', { name: '👍' }));

    expect(await screen.findByText('👍 1')).toBeInTheDocument();
    expect(services.messageService.reactToMessage).toHaveBeenCalledWith('m1', '👍');
  });

  it('appends incoming realtime messages for the current chat', async () => {
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([]);

    render(<ChatThreadPage chatId="chat-1" />);
    await screen.findByRole('heading', { name: 'Team' });

    eventBus.emit('new_message', {
      chatId: 'chat-1',
      message: {
        id: 'm4',
        chatId: 'chat-1',
        senderId: 'u2',
        senderFirstName: 'Anna',
        content: 'Realtime hello',
        createdAt: '2026-06-03T12:03:00Z',
      },
    });

    expect(await screen.findByText('Realtime hello')).toBeInTheDocument();
    expect(services.messageService.addMessageToCache).toHaveBeenCalled();
  });

  it('ignores incoming realtime messages for another chat', async () => {
    services.chatService.getChat.mockResolvedValue({ id: 'chat-1', name: 'Team', type: 'group' });
    services.messageService.getMessages.mockResolvedValue([]);

    render(<ChatThreadPage chatId="chat-1" />);
    await screen.findByRole('heading', { name: 'Team' });

    eventBus.emit('new_message', {
      chatId: 'chat-2',
      message: {
        id: 'm5',
        chatId: 'chat-2',
        senderId: 'u2',
        content: 'Wrong chat',
      },
    });

    expect(screen.queryByText('Wrong chat')).not.toBeInTheDocument();
  });

  it('renders a load error', async () => {
    services.chatService.getChat.mockRejectedValue(new Error('Access denied'));
    services.messageService.getMessages.mockResolvedValue([]);

    render(<ChatThreadPage chatId="chat-1" />);

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});
