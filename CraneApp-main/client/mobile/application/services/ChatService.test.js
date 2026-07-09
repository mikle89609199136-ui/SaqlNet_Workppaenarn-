import { describe, expect, it, vi } from 'vitest';
import ChatService from './ChatService.js';

function createApiClient() {
  return {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  };
}

describe('ChatService', () => {
  it('unwraps v2 chat payloads', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockResolvedValue({ data: { chat: { id: 'chat-1', title: 'Team', type: 'group' } } });
    const service = new ChatService(apiClient);

    const chat = await service.getChat('chat-1');

    expect(apiClient.get).toHaveBeenCalledWith('/chats/chat-1');
    expect(chat.id).toBe('chat-1');
    expect(chat.name).toBe('Team');
  });

  it('creates private chats through the v2 private endpoint', async () => {
    const apiClient = createApiClient();
    apiClient.post.mockResolvedValue({ data: { chatId: 'chat-1', exists: false } });
    const service = new ChatService(apiClient);

    const result = await service.createChat('private', ['user-2']);

    expect(apiClient.post).toHaveBeenCalledWith('/chats/private', { userId: 'user-2' });
    expect(result.chatId).toBe('chat-1');
  });

  it('creates group chats through the v2 groups endpoint', async () => {
    const apiClient = createApiClient();
    apiClient.post.mockResolvedValue({ data: { chatId: 'chat-2', title: 'Team' } });
    const service = new ChatService(apiClient);

    const result = await service.createChat('group', ['user-2'], 'Team');

    expect(apiClient.post).toHaveBeenCalledWith('/chats/groups', { members: ['user-2'], title: 'Team' });
    expect(result.chatId).toBe('chat-2');
  });

  it('creates groups with description through the group helper', async () => {
    const apiClient = createApiClient();
    apiClient.post.mockResolvedValue({ data: { chatId: 'chat-2', title: 'Team' } });
    const service = new ChatService(apiClient);

    const result = await service.createGroup({ title: 'Team', description: 'Ops', members: ['user-2'] });

    expect(apiClient.post).toHaveBeenCalledWith('/chats/groups', {
      title: 'Team',
      description: 'Ops',
      members: ['user-2'],
    });
    expect(result.chatId).toBe('chat-2');
  });

  it('normalizes user search payloads', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockResolvedValue({ data: { users: [{ id: 'u1', first_name: 'Ann', avatar_url: '/a.png' }] } });
    const service = new ChatService(apiClient);

    const users = await service.searchUsers('ann');

    expect(apiClient.get).toHaveBeenCalledWith('/users/search', { q: 'ann' });
    expect(users[0]).toMatchObject({ id: 'u1', firstName: 'Ann', avatarUrl: '/a.png' });
  });

  it('normalizes member payloads and exposes moderation actions', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockResolvedValue({ data: { members: [{ user_id: 'u1', first_name: 'Ann', role: 'owner' }] } });
    apiClient.post.mockResolvedValue({ data: { success: true } });
    apiClient.delete.mockResolvedValue({ data: { success: true } });
    const service = new ChatService(apiClient);

    const members = await service.getMembers('chat-1');
    await service.setMemberRole('chat-1', 'u1', 'admin');
    await service.removeMember('chat-1', 'u1');

    expect(members[0]).toMatchObject({ id: 'u1', firstName: 'Ann', role: 'owner' });
    expect(apiClient.post).toHaveBeenCalledWith('/chats/chat-1/members/u1/role', { role: 'admin' });
    expect(apiClient.delete).toHaveBeenCalledWith('/chats/chat-1/members/u1');
  });
});
