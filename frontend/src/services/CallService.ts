import { API_ENDPOINTS, type ApiClient } from '@/shared/api';
import type {
  ICallRoomCreateRequest,
  ICallRoomResponse,
  IIceConfiguration,
} from './types/callApi.types';

export class CallService {
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /** Создание новой комнаты звонка через POST /calls/rooms */
  async createRoom(request: ICallRoomCreateRequest): Promise<ICallRoomResponse> {
    const response = await this.apiClient.post<ICallRoomResponse>(API_ENDPOINTS.CALL_ROOMS, {
      chatId: request.chatId,
      type: request.type ?? 'p2p',
      title: request.title ?? '',
      callKind: request.callKind ?? 'video',
    });
    return response.data;
  }

  /** Получение данных существующей комнаты через GET /calls/rooms/{id} */
  async getRoom(roomId: string): Promise<ICallRoomResponse> {
    const response = await this.apiClient.get<ICallRoomResponse>(API_ENDPOINTS.CALL_ROOM(roomId));
    return response.data;
  }

  /** Получение STUN/TURN конфигурации через GET /calls/ice-servers */
  async getIceServers(): Promise<IIceConfiguration> {
    const response = await this.apiClient.get<IIceConfiguration>(API_ENDPOINTS.CALL_ICE_SERVERS);
    return response.data;
  }
}
