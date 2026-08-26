import { API_ENDPOINTS, ApiClient } from '@/api';
import { getRawChat, invalidateChat } from '@/core';
import type {
  IChatDto,
  IChatResponse,
  IChatsResponse,
  ICreateGroupChatResponse,
  IMembersListResponse,
  ISearchUsersResponse,
  TChatRole,
  TChatType,
  TMembersList,
} from '@/types';

export class ChatService {
  private apiClient: ApiClient;
  private membersRequests = new Map<string, Promise<TMembersList>>();
  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  // Свежестью списка распоряжается слой запросов: собственный кеш здесь
  // сбрасывался только при ошибке, и успешный ответ жил до перезагрузки
  // вкладки — созданный чат в списке не появлялся.
  async getChats() {
    const response = await this.apiClient.get<IChatsResponse>(API_ENDPOINTS.CHATS);
    return response.data.chats;
  }

  async getChat(chatId: string) {
    const raw = await getRawChat(this.apiClient, chatId);
    return raw;
  }

  async createChat(type: TChatType, participants: string[], title = '') {
    if (type === 'private') {
      return this.apiClient
        .post(API_ENDPOINTS.CHAT_PRIVATE, { userId: participants[0] })
        .then((response) => response.data);
    }

    return this.apiClient
      .post(API_ENDPOINTS.CHAT_GROUPS, { members: participants, title })
      .then((response) => response.data);
  }

  async createGroup({
    title,
    description = '',
    members = [],
  }: {
    title: string;
    description: string;
    members: string[];
  }): Promise<ICreateGroupChatResponse> {
    const chat = await this.apiClient
      .post<ICreateGroupChatResponse>(API_ENDPOINTS.CHAT_GROUPS, { title, description, members })
      .then((response) => response.data);

    return chat;
  }

  async searchUsers(query: string) {
    return (
      this.apiClient
        .get<ISearchUsersResponse>(API_ENDPOINTS.USER_SEARCH, { q: query })
        // Когда никто не нашёлся, сервер присылает null вместо пустого списка,
        // а вызывающий код рисует результат перебором.
        .then((response) => response.data.users ?? [])
    );
  }

  async getMembers(chatId: string): Promise<TMembersList> {
    const cached = this.membersRequests.get(chatId);
    if (cached) {
      return cached;
    }

    const request = this.apiClient
      .get<IMembersListResponse>(API_ENDPOINTS.CHAT_MEMBERS(chatId))
      .then((response) => response.data.members)
      .catch((err) => {
        this.membersRequests.delete(chatId); // не кэшируем ошибку — следующий вызов попробует заново
        throw err;
      });

    this.membersRequests.set(chatId, request);
    return request;
  }

  async setMemberRole(chatId: string, userId: string, role: TChatRole) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_MEMBER_ROLE(chatId, userId), { role })
      .then((response) => response.data);
  }

  async removeMember(chatId: string, userId: string) {
    return this.apiClient
      .delete(API_ENDPOINTS.CHAT_MEMBER(chatId, userId))
      .then((response) => response.data);
  }

  async updateChat(
    chatId: string,
    data: Partial<
      Omit<IChatDto, 'id' | 'peerId' | 'peerPublicKey' | 'ownerId' | 'createdAt' | 'type'>
    >
  ): Promise<IChatDto> {
    const response = await this.apiClient.put<IChatResponse>(
      API_ENDPOINTS.CHAT_BY_ID(chatId),
      data
    );
    invalidateChat(chatId);
    return response.data.chat;
  }

  async deleteChat<T>(chatId: string): Promise<T> {
    const response = await this.apiClient.delete<T>(API_ENDPOINTS.CHAT_BY_ID(chatId));
    invalidateChat(chatId);
    return response.data;
  }

  async muteChat(chatId: string, duration: number) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_MUTE(chatId), { duration });
    invalidateChat(chatId);
    return response.data;
  }

  async pinChat(chatId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_PIN(chatId));
    invalidateChat(chatId);
    return response.data;
  }

  async archiveChat(chatId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_ARCHIVE(chatId));
    invalidateChat(chatId);
    return response.data;
  }
}
