import { API_ENDPOINTS } from "@/api";

export class CallService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  createRoom({ type, chatId, title, callKind }) {
    return this.apiClient
      .post(API_ENDPOINTS.CALL_ROOMS, { type, chatId, title, callKind })
      .then((response) => response.data?.room ?? response.data);
  }
}