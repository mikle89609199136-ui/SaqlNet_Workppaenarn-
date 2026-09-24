import { API_ENDPOINTS, type ApiClient } from '@/shared/api';

export interface IMediaUploadResponse {
  contentType?: string;
  fileName?: string;
  sizeBytes?: number;
  success?: boolean;
  url: string;
}

export class MediaService {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async upload(file: File): Promise<IMediaUploadResponse> {
    const form = new FormData();
    form.append('file', file);
    const response = await this.apiClient.post<IMediaUploadResponse>(
      API_ENDPOINTS.MEDIA_UPLOAD,
      form
    );
    return response.data;
  }
}
