import { STORAGE_KEYS, config } from '@/shared/config';
import { ApiClient } from './ApiClient';

interface ICreateApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
}

/**
 * Фабрика для создания изолированного клиента ApiClient.
 * Используется преимущественно в тестах для изоляции токена и состояния.
 */
export function createApiClient(options: ICreateApiClientOptions = {}): ApiClient {
  return new ApiClient(options.baseUrl ?? config.apiBaseUrl, {
    getToken:
      options.getToken ?? (() => globalThis.localStorage?.getItem(STORAGE_KEYS.TOKEN) ?? null),
  });
}

export const apiClient = createApiClient();
