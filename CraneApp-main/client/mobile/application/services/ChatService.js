import Chat from '../../domain/entities/Chat.js';
import API_ENDPOINTS from '../../infrastructure/api/endpoints.js';

class ChatService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async getChats() {
    const response = await this.apiClient.get(API_ENDPOINTS.CHATS);
    return this.normalizeList(response.data).map((item) => Chat.fromAPI(item));
  }

  async getChat(chatId) {
    const response = await this.apiClient.get(API_ENDPOINTS.CHAT_BY_ID(chatId));
    return Chat.fromAPI(response.data?.chat ?? response.data);
  }

  createChat(type, participants, title = '') {
    if (type === 'private') {
      return this.apiClient
        .post(API_ENDPOINTS.CHAT_PRIVATE, { userId: participants[0] })
        .then((response) => response.data);
    }

    return this.apiClient
      .post(API_ENDPOINTS.CHAT_GROUPS, { members: participants, title })
      .then((response) => response.data);
  }

  createGroup({ title, description = '', members = [] }) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_GROUPS, { title, description, members })
      .then((response) => response.data);
  }

  searchUsers(query) {
    return this.apiClient
      .get(API_ENDPOINTS.USER_SEARCH, { q: query })
      .then((response) => this.normalizeUsers(response.data));
  }

  getMembers(chatId) {
    return this.apiClient
      .get(API_ENDPOINTS.CHAT_MEMBERS(chatId))
      .then((response) => this.normalizeMembers(response.data));
  }

  setMemberRole(chatId, userId, role) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_MEMBER_ROLE(chatId, userId), { role })
      .then((response) => response.data);
  }

  removeMember(chatId, userId) {
    return this.apiClient
      .delete(API_ENDPOINTS.CHAT_MEMBER(chatId, userId))
      .then((response) => response.data);
  }

  updateChat(chatId, data) {
    return this.apiClient
      .put(API_ENDPOINTS.CHAT_BY_ID(chatId), data)
      .then((response) => Chat.fromAPI(response.data));
  }

  deleteChat(chatId) {
    return this.apiClient
      .delete(API_ENDPOINTS.CHAT_BY_ID(chatId))
      .then((response) => response.data);
  }

  muteChat(chatId, duration) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_MUTE(chatId), { duration })
      .then((response) => response.data);
  }

  pinChat(chatId) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_PIN(chatId))
      .then((response) => response.data);
  }

  archiveChat(chatId) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_ARCHIVE(chatId))
      .then((response) => response.data);
  }

  normalizeList(data) {
    if (Array.isArray(data)) return data;
    return data?.chats ?? data?.items ?? [];
  }

  normalizeUsers(data) {
    const users = Array.isArray(data) ? data : data?.users ?? data?.items ?? [];
    return users.map((user) => ({
      id: user.id ?? user.userId ?? user.user_id,
      username: user.username ?? '',
      firstName: user.firstName ?? user.first_name ?? '',
      lastName: user.lastName ?? user.last_name ?? '',
      avatarUrl: user.avatarUrl ?? user.avatar_url ?? '',
    })).filter((user) => user.id);
  }

  normalizeMembers(data) {
    const members = Array.isArray(data) ? data : data?.members ?? data?.items ?? [];
    return members.map((member) => ({
      id: member.id ?? member.userId ?? member.user_id,
      username: member.username ?? '',
      firstName: member.firstName ?? member.first_name ?? '',
      lastName: member.lastName ?? member.last_name ?? '',
      avatarUrl: member.avatarUrl ?? member.avatar_url ?? '',
      role: member.role ?? 'member',
      permissions: member.permissions ?? {},
      mutedUntil: member.mutedUntil ?? member.muted_until ?? '',
      joinedAt: member.joinedAt ?? member.joined_at ?? '',
      isOnline: member.isOnline ?? member.is_online ?? false,
    })).filter((member) => member.id);
  }
}

export default ChatService;
