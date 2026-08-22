import { API_ENDPOINTS, ApiClient } from "@/api";

export class EmojiService {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  list() {
    return this.apiClient
      .get(API_ENDPOINTS.EMOJIS)
      .then((response) => response.data);
  }
}
