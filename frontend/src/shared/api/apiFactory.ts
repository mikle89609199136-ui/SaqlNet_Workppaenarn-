import { config, STORAGE_KEYS } from '@/shared/config';
import { ApiClient } from './ApiClient';

interface ICreateApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
}

/**
 * Отдельный клиент со своими настройками.
 *
 * Нужен там, где общий синглтон мешает: сейчас это тесты, которым нужен
 * свой клиент, не завязанный на localStorage и на общий адрес.
 */
export function createApiClient(options: ICreateApiClientOptions = {}): ApiClient {
  return new ApiClient(options.baseUrl ?? config.apiBaseUrl, {
    getToken:
      options.getToken ?? (() => globalThis.localStorage?.getItem(STORAGE_KEYS.TOKEN) ?? null),
  });
}

export const apiClient = createApiClient();
