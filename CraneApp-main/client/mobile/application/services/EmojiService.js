import API_ENDPOINTS from '../../infrastructure/api/endpoints.js';

class EmojiService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  list() {
    return this.apiClient
      .get(API_ENDPOINTS.EMOJIS)
      .then((response) => response.data);
  }
}

export default EmojiService;
