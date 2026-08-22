import type { ApiClient } from "@/api";
import { STORAGE_KEYS } from "@/consts";

export class MediaService {
  private apiClient: ApiClient

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    const response = await fetch('/api/v2/media', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Ошибка загрузки файла');
    }
    return data.upload;
  }

  getUrl(uploadId: string) {
    return `/api/v2/media/${uploadId}`;
  }

  async getUpload(uploadId: string) {
    const { data } = await this.apiClient.get(`/media/${uploadId}`);
    return data.upload ?? data;
  }
}