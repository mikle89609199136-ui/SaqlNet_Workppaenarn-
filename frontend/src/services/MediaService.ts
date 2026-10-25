import { API_ENDPOINTS, type ApiClient } from '@/shared/api';
import type { IGif, ISticker, IStickerPack } from '@/entities/media';

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

  async listStickerPacks(): Promise<IStickerPack[]> {
    const response = await this.apiClient.get<{ packs: IStickerPack[] }>(
      API_ENDPOINTS.STICKER_PACKS
    );
    return response.data?.packs ?? [];
  }

  async listStickers(packId: string): Promise<ISticker[]> {
    const response = await this.apiClient.get<{ stickers: ISticker[] }>(
      API_ENDPOINTS.STICKER_PACK(packId)
    );
    return response.data?.stickers ?? [];
  }

  async listGifs(): Promise<IGif[]> {
    const response = await this.apiClient.get<{ gifs: IGif[] }>(API_ENDPOINTS.GIFS);
    return response.data?.gifs ?? [];
  }

  async listFavoriteGifs(): Promise<IGif[]> {
    const response = await this.apiClient.get<{ gifs: IGif[] }>(API_ENDPOINTS.GIFS_FAVORITES);
    return response.data?.gifs ?? [];
  }

  async favoriteGif(gifId: string): Promise<void> {
    await this.apiClient.post(API_ENDPOINTS.GIF_FAVORITE(gifId));
  }

  async unfavoriteGif(gifId: string): Promise<void> {
    await this.apiClient.delete(API_ENDPOINTS.GIF_FAVORITE(gifId));
  }
}
