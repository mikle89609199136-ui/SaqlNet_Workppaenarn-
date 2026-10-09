import { API_ENDPOINTS, ApiClient } from '@/shared/api';
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
  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  // Свежестью списка распоряжается слой запросов: собственный кеш здесь
  // сбрасывался только при ошибке, и успешный ответ жил до перезагрузки
  // вкладки — созданный чат в списке не появлялся.
  /**
   * Список чатов. Архивные лежат отдельно и приходят только по просьбе:
   * сервер фильтрует по `archived`, а не отдаёт всё вперемешку.
   */
  async getChats(archived = false) {
    const response = await this.apiClient.get<IChatsResponse>(
      API_ENDPOINTS.CHATS,
      archived ? { archived: 'true' } : {}
    );
    return response.data.chats;
  }

  // Запрос без собственного кеша: это функция загрузки для chat-запроса,
  // и кеширование — его забота.
  async getChat(chatId: string): Promise<IChatDto> {
    const response = await this.apiClient.get<IChatResponse>(API_ENDPOINTS.CHAT_BY_ID(chatId));
    return response.data.chat;
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
    avatarUrl = '',
  }: {
    title: string;
    description: string;
    members: string[];
    avatarUrl?: string;
  }): Promise<ICreateGroupChatResponse> {
    const chat = await this.apiClient
      .post<ICreateGroupChatResponse>(API_ENDPOINTS.CHAT_GROUPS, {
        title,
        description,
        members,
        // Аватарка хранится строкой, поэтому уходит уменьшенной картинкой
        // прямо в теле запроса: отдельная загрузка файла тут не нужна.
        ...(avatarUrl ? { avatarUrl } : {}),
      })
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

  // Свежесть списка — забота слоя запросов: раньше промис оставался в
  // сервисе навсегда, и смена роли не была видна даже после переоткрытия.
  async getMembers(chatId: string): Promise<TMembersList> {
    return this.apiClient
      .get<IMembersListResponse>(API_ENDPOINTS.CHAT_MEMBERS(chatId))
      .then((response) => response.data.members ?? []);
  }

  /** Кто из участников группы сейчас в сети — идентификаторы (#822). */
  async getOnlineMembers(chatId: string): Promise<string[]> {
    return this.apiClient
      .get<{ members?: string[] }>(API_ENDPOINTS.CHAT_MEMBERS_ONLINE(chatId))
      .then((response) => response.data.members ?? []);
  }

  /** Добавить участника в группу: владелец или админ, по одному (#822). */
  async addMember(chatId: string, userId: string) {
    return this.apiClient.post(API_ENDPOINTS.CHAT_MEMBER_ADD(chatId), { userId });
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
    // Сервер принимает частичное изменение чата методом PATCH: с PUT
    // переименование группы отвечало 405.
    const response = await this.apiClient.patch<IChatResponse>(
      API_ENDPOINTS.CHAT_BY_ID(chatId),
      data
    );
    return response.data.chat;
  }

  async deleteChat<T>(chatId: string): Promise<T> {
    const response = await this.apiClient.delete<T>(API_ENDPOINTS.CHAT_BY_ID(chatId));
    return response.data;
  }

  /**
   * Выйти из группы самому (#90). Удалить себя через `removeMember` нельзя:
   * это действие модератора над другим участником, и сервер его отклоняет.
   * Владельцу выйти нельзя (409 `ownership_transfer_required`), пока он не
   * передал права.
   */
  async leaveChat(chatId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_LEAVE(chatId));
    return response.data;
  }

  /** Сделать участника владельцем; прежний владелец становится участником. */
  async transferOwnership(chatId: string, userId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_TRANSFER_OWNERSHIP(chatId), {
      userId,
    });
    return response.data;
  }

  async setNotificationPreview(chatId: string, hideNotificationPreview: boolean) {
    return this.apiClient.put(API_ENDPOINTS.CHAT_NOTIFICATION_SETTINGS(chatId), {
      hideNotificationPreview,
    });
  }

  async pinChat(chatId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_PIN(chatId));
    return response.data;
  }

  async unpinChat(chatId: string) {
    const response = await this.apiClient.delete(API_ENDPOINTS.CHAT_PIN(chatId));
    return response.data;
  }

  async archiveChat(chatId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_ARCHIVE(chatId));
    return response.data;
  }

  async unarchiveChat(chatId: string) {
    const response = await this.apiClient.delete(API_ENDPOINTS.CHAT_ARCHIVE(chatId));
    return response.data;
  }

  /**
   * Отметить чат прочитанным целиком.
   *
   * Не то же самое, что отметки по отдельным сообщениям
   * (`POST /messages/read`): там список идентификаторов того, что попало в
   * поле зрения, и чат с сотней непрочитанных пришлось бы пролистать
   * целиком. Здесь чат закрывается разом.
   *
   * События о прочтении сервер не рассылает никому — ни нам, ни
   * собеседнику, — поэтому счётчик в списке обновляет вызывающая сторона.
   */
  async markChatRead(chatId: string) {
    const response = await this.apiClient.post(API_ENDPOINTS.CHAT_READ(chatId));
    return response.data;
  }
}
