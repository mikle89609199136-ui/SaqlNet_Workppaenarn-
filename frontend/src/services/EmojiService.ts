import { API_ENDPOINTS, ApiClient } from '@/shared/api';
import type { IEmojisResponse } from '@/types/response.types';

export class EmojiService {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  list(): Promise<IEmojisResponse> {
    return this.apiClient
      .get<IEmojisResponse>(API_ENDPOINTS.EMOJIS)
      .then((response) => response.data);
  }
}
