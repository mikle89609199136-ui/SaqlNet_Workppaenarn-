import { config } from '@/configs/app';
import { STORAGE_KEYS } from '@/consts';
import { ApiClient } from './ApiClient';

interface ICreateApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
}

/**
 * Отдельный клиент со своими настройками. Нужен там, где общий синглтон
 * мешает: в тестах и в местах, которым требуется другой адрес или токен.
 */
export function createApiClient(options: ICreateApiClientOptions = {}): ApiClient {
  return new ApiClient(options.baseUrl ?? config.apiBaseUrl, {
    getToken:
      options.getToken ?? (() => globalThis.localStorage?.getItem(STORAGE_KEYS.TOKEN) ?? null),
  });
}

export const apiClient = createApiClient();

export default apiClient;
