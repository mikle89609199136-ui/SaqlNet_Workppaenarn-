import API_ENDPOINTS from '../../infrastructure/api/endpoints.js';

class CallService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  createRoom({ type, chatId, title }) {
    return this.apiClient
      .post(API_ENDPOINTS.CALL_ROOMS, { type, chatId, title })
      .then((response) => response.data?.room ?? response.data);
  }
}

export default CallService;
